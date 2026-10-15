// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

// registerSettingsCommand — the name-compatible entry for hosts migrating
// from the terminal variant: builds the settings handle over the injected
// seams, loads it, and returns it (the surface registration itself is the
// host's — this variant owns no command surface). Red first — the module
// export does not exist yet.

import { describe, expect, test } from "vitest";
import type { FsAdapter } from "../src/fs-adapter.js";
import { registerSettingsCommand } from "../src/index.js";
import type { SettingsSchema } from "../src/schema.js";

function memFs(files: Record<string, string> = {}): FsAdapter {
  const store = new Map(Object.entries(files));
  return {
    read: async (path) => store.get(path) ?? null,
    write: async (path, content) => void store.set(path, content),
    exists: async (path) => store.has(path),
  };
}

const SCHEMA: SettingsSchema = {
  tabs: [{ label: "General", settingIds: ["enabled"] }],
  settings: [{ id: "enabled", label: "Enabled", type: "boolean", defaultValue: true }],
  globalPath: (globalDir?: string) => `${globalDir ?? "/home"}/x-settings.json`,
  projectPath: (cwd: string) => `${cwd}/.claude/x-settings.json`,
} as unknown as SettingsSchema;

describe("registerSettingsCommand — the name-compatible entry", () => {
  test("builds + loads the handle and returns the SettingsHandle shape", async () => {
    const handle = registerSettingsCommand(null, SCHEMA, {
      fs: memFs(),
      env: { get: () => undefined, set: () => {} },
      envVar: "TEST_SETTINGS",
      cwd: "/work/proj",
      globalDir: "/home",
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(handle.getSettings()).toEqual({ enabled: true });
    expect(handle.storageLevels).toEqual(["session", "project", "global"]);
    handle.updateSetting("enabled", false);
    expect(handle.getSettings().enabled).toBe(false);
  });

  test("global file values load through the ladder", async () => {
    const handle = registerSettingsCommand(null, SCHEMA, {
      fs: memFs({ "/home/x-settings.json": JSON.stringify({ enabled: false }) }),
      env: { get: () => undefined, set: () => {} },
      cwd: "/work/proj",
      globalDir: "/home",
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(handle.getSettings()).toEqual({ enabled: false });
  });
});
