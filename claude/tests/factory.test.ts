// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

// Factory port tests: buffer-mode semantics over injected fs/env seams.
// The handle loads (env-first → defaults→global→project layering → clamp →
// env serialize), updates sync through the gate, persists by whole-file
// rewrites that preserve foreign keys. Red first — the module does not exist.

import { describe, expect, test } from "vitest";
import { captureCtx } from "../src/ctx-store.js";
import { createSettingsExtension, type EnvStore } from "../src/factory.js";
import type { FsAdapter } from "../src/fs-adapter.js";
import { resolveModelPresets } from "../src/model-presets.js";
import type { SettingsSchema } from "../src/schema.js";

function memFs(files: Record<string, string> = {}): FsAdapter & { dump(): Record<string, string> } {
  const store = new Map(Object.entries(files));
  return {
    async read(path) {
      return store.get(path) ?? null;
    },
    async write(path, content) {
      store.set(path, content);
    },
    async exists(path) {
      return store.has(path);
    },
    dump() {
      return Object.fromEntries(store);
    },
  };
}

function memEnv(vars: Record<string, string> = {}): EnvStore & { dump(): Record<string, string | undefined> } {
  const store = new Map(Object.entries(vars));
  return {
    get(name) {
      return store.get(name);
    },
    set(name, value) {
      store.set(name, value);
    },
    dump() {
      return Object.fromEntries(store);
    },
  };
}

const SCHEMA: SettingsSchema = {
  tabs: [{ label: "General", settingIds: ["enabled", "interval"] }],
  settings: [
    { id: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
    { id: "interval", label: "Interval", type: "duration", defaultValue: 30000, min: 1000, max: 600000 },
  ],
  globalPath: (globalDir?: string) => `${globalDir ?? "/home"}/x-settings.json`,
  projectPath: (cwd: string) => `${cwd}/.claude/x-settings.json`,
} as unknown as SettingsSchema;

const GLOBAL = "/home/x-settings.json";
const PROJECT = "/work/proj/.claude/x-settings.json";
const ENV_VAR = "TEST_SETTINGS";

function makeHandle(opts?: { envVar?: string }) {
  const fs = memFs();
  const env = memEnv();
  const handle = createSettingsExtension(SCHEMA, {
    fs,
    env,
    envVar: opts?.envVar ?? ENV_VAR,
  });
  return { fs, env, handle };
}

describe("load — the layering ladder", () => {
  test("no files: defaults; env var serialized after load", async () => {
    const { fs, env, handle } = makeHandle();
    await handle.load("/work/proj", "/home");
    expect(handle.getSettings()).toEqual({ enabled: true, interval: 30000 });
    expect(JSON.parse(env.dump()[ENV_VAR] ?? "null")).toEqual({ enabled: true, interval: 30000 });
    expect(Object.keys(fs.dump()).length).toBe(0);
  });

  test("global then project layering (project keys only)", async () => {
    const { env } = makeHandle();
    const fs = memFs({
      [GLOBAL]: JSON.stringify({ enabled: false }),
      [PROJECT]: JSON.stringify({ interval: "2m" }),
    });
    const h2 = createSettingsExtension(SCHEMA, { fs, env, envVar: ENV_VAR });
    await h2.load("/work/proj", "/home");
    expect(h2.getSettings()).toEqual({ enabled: false, interval: 120000 });
  });

  test("env var wins over files (subagent propagation)", async () => {
    const fs = memFs({ [GLOBAL]: JSON.stringify({ enabled: false }) });
    const env = memEnv({ [ENV_VAR]: JSON.stringify({ enabled: true, interval: 60000 }) });
    const handle = createSettingsExtension(SCHEMA, { fs, env, envVar: ENV_VAR });
    await handle.load("/work/proj", "/home");
    expect(handle.getSettings()).toEqual({ enabled: true, interval: 60000 });
  });

  test("invalid env JSON falls back to defaults (the gate throws before files)", async () => {
    const fs = memFs({ [GLOBAL]: JSON.stringify({ enabled: false }) });
    const env = memEnv({ [ENV_VAR]: "{broken" });
    const handle = createSettingsExtension(SCHEMA, { fs, env, envVar: ENV_VAR });
    await handle.load("/work/proj", "/home");
    expect(handle.getSettings()).toEqual({ enabled: true, interval: 30000 });
  });

  test("a promise-shaped env adapter is awaited (the platform $.env.get returns a Promise)", async () => {
    // Without the await, load() feeds JSON.parse a Promise, the guard throws,
    // and the WHOLE ladder (env + project/global files) degrades to defaults.
    const fs = memFs({ [PROJECT]: JSON.stringify({ interval: "90s" }) });
    const env: EnvStore = {
      get: (name) => Promise.resolve(name === ENV_VAR ? JSON.stringify({ enabled: false }) : undefined),
      set: () => {},
    };
    const handle = createSettingsExtension(SCHEMA, { fs, env, envVar: ENV_VAR });
    await handle.load("/work/proj", "/home");
    expect(handle.getSettings()).toEqual({ enabled: false, interval: 30000 });
  });
});

describe("updateSetting — the sync gate", () => {
  test("valid value updates the buffer + env; invalid is rejected silently", async () => {
    const { env, handle } = makeHandle();
    await handle.load("/work/proj", "/home");
    handle.updateSetting("interval", "90s");
    expect(handle.getSettings().interval).toBe(90000);
    expect(JSON.parse(env.dump()[ENV_VAR] ?? "{}").interval).toBe(90000);
    handle.updateSetting("interval", "garbage");
    expect(handle.getSettings().interval).toBe(90000);
  });

  test("unknown key is a no-op; aliases resolve to canonical", async () => {
    const { handle } = makeHandle();
    await handle.load("/work/proj", "/home");
    handle.updateSetting("nope", 1);
    handle.updateSetting(undefined as unknown as string, 1);
    expect(handle.getSettings()).toEqual({ enabled: true, interval: 30000 });
  });
});

describe("persist — whole-file rewrites", () => {
  test("persistToGlobal writes the normalized buffer, preserving foreign keys", async () => {
    const fs = memFs({ [GLOBAL]: JSON.stringify({ enabled: false, foreignKey: "keep" }) });
    const env = memEnv();
    const handle = createSettingsExtension(SCHEMA, { fs, env, envVar: ENV_VAR });
    await handle.load("/work/proj", "/home");
    handle.updateSetting("interval", "2m");
    await handle.persistToGlobal();
    const written = JSON.parse(fs.dump()[GLOBAL]);
    expect(written).toEqual({ enabled: false, foreignKey: "keep", interval: 120000 });
  });

  test("persistToProject writes under the cwd's .claude", async () => {
    const { fs, handle } = makeHandle();
    await handle.load("/work/proj", "/home");
    handle.updateSetting("enabled", false);
    await handle.persistToProject("/work/proj");
    const written = JSON.parse(fs.dump()[PROJECT]);
    expect(written).toEqual({ enabled: false, interval: 30000 });
  });
});

describe("computeDefaults + storageLevels", () => {
  test("defaults derive from the schema; levels default to all three", async () => {
    const { handle } = makeHandle();
    expect(handle.computeDefaults()).toEqual({ enabled: true, interval: 30000 });
    expect(handle.storageLevels).toEqual(["session", "project", "global"]);
  });
});

describe("factory — the stateless single-file mode (pi live-save parity)", () => {
  test("storageLevels ['project'] alone: updateSetting writes through to the file immediately", async () => {
    const fs = memFs();
    const env = memEnv();
    const lib = createSettingsExtension(SCHEMA, { fs, env, envVar: ENV_VAR, storageLevels: ["project"] });
    await lib.load("/work/proj", "/home");
    lib.updateSetting("interval", 60000);
    // NO persist call — the write-through lands by itself (a tick for the
    // async fire-and-forget chain)
    await new Promise((resolve) => setTimeout(resolve, 10));
    const saved = JSON.parse(fs.dump()[PROJECT] as string);
    expect(saved.interval).toBe(60000);
  });

  test("a second instance sees the write (fresh load reads the file)", async () => {
    const fs = memFs();
    const env = memEnv();
    const a = createSettingsExtension(SCHEMA, { fs, env, envVar: ENV_VAR, storageLevels: ["project"] });
    await a.load("/work/proj", "/home");
    a.updateSetting("interval", 90000);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const b = createSettingsExtension(SCHEMA, { fs, env, envVar: ENV_VAR, storageLevels: ["project"] });
    await b.load("/work/proj", "/home");
    expect(b.getSettings().interval).toBe(90000);
  });

  test("multi-level (session included) keeps BUFFER mode: no file write until persist", async () => {
    const fs = memFs();
    const env = memEnv();
    const lib = createSettingsExtension(SCHEMA, {
      fs,
      env,
      envVar: ENV_VAR,
      storageLevels: ["session", "project", "global"],
    });
    await lib.load("/work/proj", "/home");
    lib.updateSetting("interval", 45000);
    expect(fs.dump()[PROJECT]).toBeUndefined();
    await lib.persistToProject();
    expect(JSON.parse(fs.dump()[PROJECT] as string).interval).toBe(45000);
  });
});

describe("model presets — the static documented-alias pairs", () => {
  test("staticModelPairs alone: Default + the statics when no models were captured", async () => {
    captureCtx({
      staticModelPairs: [
        ["haiku", "haiku"],
        ["sonnet", "sonnet"],
      ],
    });
    const pairs = await resolveModelPresets();
    expect(pairs).toEqual([
      ["Default", null],
      ["haiku", "haiku"],
      ["sonnet", "sonnet"],
    ]);
  });

  test("statics prepend ahead of captured models; scoped capture unaffected", async () => {
    captureCtx({
      models: [{ id: "mimo-v2.6-flash", provider: "custom" }],
      enabledModelPatterns: null,
      staticModelPairs: [["opus", "opus"]],
    });
    const pairs = await resolveModelPresets();
    expect(pairs[0]).toEqual(["Default", null]);
    expect(pairs[1]).toEqual(["opus", "opus"]);
    expect(pairs[2]).toEqual(["mimo-v2.6-flash [custom]", "custom/mimo-v2.6-flash"]);
  });
});
