// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

// Persistence port tests over an in-memory fs adapter: layered load
// (defaults → global → project-override), whole-file writes, and the Claude
// path conventions. Red first — the modules do not exist yet.

import { describe, expect, test } from "vitest";
import type { FsAdapter } from "../src/fs-adapter.js";
import { loadSettingsFromFiles, readJsonFile, settingsFilePaths, writeJsonFile } from "../src/persistence.js";
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

const SCHEMA: SettingsSchema = {
  tabs: [
    { id: "general", label: "General" },
    { id: "advanced", label: "Advanced" },
  ],
  settings: [
    {
      id: "enabled",
      label: "Enabled",
      type: "boolean",
      defaultValue: true,
      tab: "general",
    },
    {
      id: "threshold",
      label: "Threshold",
      type: "number",
      defaultValue: 5,
      min: 0,
      max: 100,
      tab: "advanced",
    },
  ],
  globalPath: (globalDir?: string) => `/home/.claude/test-settings.json?g=${globalDir ?? "default"}`,
  projectPath: (cwd: string) => `${cwd}/.claude/test-settings.json`,
} as unknown as SettingsSchema;

describe("settingsFilePaths — Claude conventions", () => {
  test("global path nests under the global dir (or home/.claude when absent)", () => {
    const paths = settingsFilePaths("avtc-session-owl");
    expect(paths.globalPath("/cfg")).toBe("/cfg/avtc-session-owl-settings.json");
    expect(paths.globalPath(undefined, "/home/me")).toBe("/home/me/.claude/avtc-session-owl-settings.json");
  });

  test("project path nests under the cwd's .claude", () => {
    const paths = settingsFilePaths("avtc-session-owl");
    expect(paths.projectPath("/work/proj")).toBe("/work/proj/.claude/avtc-session-owl-settings.json");
  });
});

describe("readJsonFile / writeJsonFile over the adapter", () => {
  test("missing file reads null; a JSON file round-trips with a trailing newline", async () => {
    const fs = memFs();
    expect(await readJsonFile(fs, "/none.json")).toBeNull();
    await writeJsonFile(fs, "/some.json", { a: 1 });
    expect(await readJsonFile(fs, "/some.json")).toEqual({ a: 1 });
    expect(fs.dump()["/some.json"]).toBe(`${JSON.stringify({ a: 1 }, null, 2)}\n`);
  });

  test("invalid JSON reads null (never throws)", async () => {
    const fs = memFs({ "/bad.json": "{oops" });
    expect(await readJsonFile(fs, "/bad.json")).toBeNull();
  });
});

describe("loadSettingsFromFiles — the layered merge", () => {
  test("defaults alone when no files exist", async () => {
    const fs = memFs();
    const loaded = await loadSettingsFromFiles(fs, "/work/proj", SCHEMA, { enabled: true, threshold: 5 }, undefined);
    expect(loaded).toEqual({ enabled: true, threshold: 5 });
  });

  test("global overrides defaults; project overrides global for its keys only", async () => {
    const fs = memFs({
      "/home/.claude/test-settings.json?g=default": JSON.stringify({ enabled: false, threshold: 50 }),
      "/work/proj/.claude/test-settings.json": JSON.stringify({ threshold: 9 }),
    });
    const loaded = await loadSettingsFromFiles(fs, "/work/proj", SCHEMA, { enabled: true, threshold: 5 }, undefined);
    // threshold comes from the project file (9); enabled stays global (false)
    expect(loaded).toEqual({ enabled: false, threshold: 9 });
  });

  test("project keys absent from the file do not leak defaults over global", async () => {
    const fs = memFs({
      "/home/.claude/test-settings.json?g=default": JSON.stringify({ enabled: false }),
      "/work/proj/.claude/test-settings.json": JSON.stringify({ threshold: 9 }),
    });
    const loaded = await loadSettingsFromFiles(fs, "/work/proj", SCHEMA, { enabled: true, threshold: 5 }, undefined);
    expect(loaded).toEqual({ enabled: false, threshold: 9 });
  });
});
