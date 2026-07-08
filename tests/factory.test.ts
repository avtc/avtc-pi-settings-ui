// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSettingsExtension } from "../src/factory.js";
import { normalizeFromSchema } from "../src/normalization.js";
import { settingsFilePaths } from "../src/persistence.js";
import type { SettingsSchema } from "../src/schema.js";

/** No value (reset to null) */
const NO_VALUE: unknown = null;

/** No global directory */
const NO_GLOBAL_DIR: string | undefined = undefined;

/** Empty options for createSettingsExtension */
const NO_OPTIONS: { clampFn?: (result: Record<string, unknown>) => void; envVar?: string; onLoad?: () => void } = {};

/** Setting value: enabled */
const SETTING_ENABLED = true;

/** Setting value: disabled */
const SETTING_DISABLED = false;

/** Test settings shape for type-safe access in tests */
type TestSettings = { codeReviewLoops: number; mode: string };

const TEST_SCHEMA: SettingsSchema = {
  settings: [
    {
      id: "codeReviewLoops",
      label: "Review Loops",
      type: "number",
      defaultValue: 3,
      aliases: ["autoReviewLoops"],
    },
    {
      id: "mode",
      label: "Mode",
      type: "string",
      defaultValue: "general",
      presets: [
        ["General", "general"],
        ["Comprehensive", "comprehensive"],
      ],
    },
  ],
  tabs: [{ label: "Test", settingIds: ["codeReviewLoops", "mode"] }],
  globalPath: () => "/tmp/test.json",
  projectPath: () => "/tmp/test.json",
};

describe("createSettingsExtension", () => {
  let handle: ReturnType<typeof createSettingsExtension<TestSettings>>;

  beforeEach(() => {
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    handle = createSettingsExtension<TestSettings>(TEST_SCHEMA, NO_OPTIONS);
    handle.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
  });

  afterEach(() => {
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
  });

  it("resolves alias key to canonical ID", () => {
    handle.updateSetting("autoReviewLoops", "3");
    // alias resolution is what's under test here, not numeric coercion.
    expect(handle.getSettings().codeReviewLoops).toBe(3);
  });

  it("stores by canonical key, not alias", () => {
    handle.updateSetting("autoReviewLoops", "2");
    const settings = handle.getSettings();
    expect(settings).toHaveProperty("codeReviewLoops");
    expect(settings).not.toHaveProperty("autoReviewLoops");
  });

  it("accepts canonical key directly", () => {
    handle.updateSetting("codeReviewLoops", "3");
    expect(handle.getSettings().codeReviewLoops).toBe(3);
  });

  it("sets null via the null preset pair regardless of defaultValue", () => {
    const schema: SettingsSchema = {
      settings: [
        {
          id: "concurrency",
          label: "Concurrency",
          type: "number",
          defaultValue: 6,
          presets: [
            ["Infinite", null],
            ["2", 2],
            ["4", 4],
            ["6", 6],
          ],
        },
      ],
      tabs: [{ label: "Test", settingIds: ["concurrency"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    h.updateSetting("concurrency", NO_VALUE);
    expect(h.getSettings().concurrency).toBeNull();
  });

  it("resets to default when value is undefined", () => {
    handle.updateSetting("codeReviewLoops", undefined);
    expect(handle.getSettings().codeReviewLoops).toBe(3);
  });

  it("resets to null default when value is undefined", () => {
    const schema: SettingsSchema = {
      settings: [
        {
          id: "branch",
          label: "Branch",
          type: "string",
          defaultValue: null as unknown as string,
          presets: [
            ["ask", null],
            ["main", "main"],
          ],
        },
      ],
      tabs: [{ label: "Test", settingIds: ["branch"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    h.updateSetting("branch", undefined);
    expect(h.getSettings().branch).toBeNull();
  });

  it("resolves a string preset value and stores it", () => {
    const schema: SettingsSchema = {
      settings: [
        {
          id: "guardrail",
          label: "Guardrail",
          type: "string",
          defaultValue: "ask",
          presets: [
            ["Off", "off"],
            ["Ask", "ask"],
            ["Block", "block"],
          ],
        },
      ],
      tabs: [{ label: "Test", settingIds: ["guardrail"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    h.updateSetting("guardrail", "off");
    expect(h.getSettings().guardrail).toBe("off");
  });

  it("resolves a numeric preset value and stores it", () => {
    const schema: SettingsSchema = {
      settings: [
        {
          id: "timeout",
          label: "Timeout",
          type: "duration",
          defaultValue: 60000,
          presets: [
            ["1m", 60000],
            ["5m", 300000],
          ],
        },
      ],
      tabs: [{ label: "Test", settingIds: ["timeout"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    h.updateSetting("timeout", 300000);
    expect(h.getSettings().timeout).toBe(300000);
  });

  it("applies clampFn after updateSetting", () => {
    let clamped = false;
    const schema: SettingsSchema = {
      settings: [{ id: "val", label: "Val", type: "number", defaultValue: 5 }],
      tabs: [{ label: "Test", settingIds: ["val"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, {
      clampFn: () => {
        clamped = true;
      },
    });
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    clamped = false; // reset after load
    h.updateSetting("val", "10");
    expect(clamped).toBe(true);
  });

  it("applies clampFn in env var path", () => {
    let clamped = false;
    const schema: SettingsSchema = {
      settings: [{ id: "val", label: "Val", type: "number", defaultValue: 5 }],
      tabs: [{ label: "Test", settingIds: ["val"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    process.env.TEST_CLAMP_SETTINGS = '{"val": 10}';
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, {
      clampFn: () => {
        clamped = true;
      },
      envVar: "TEST_CLAMP_SETTINGS",
    });
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    expect(clamped).toBe(true);
    delete process.env.TEST_CLAMP_SETTINGS;
  });

  it("clampFn receives settings and mutations persist in getSettings", () => {
    // Verify clampFn gets the actual settings object and can mutate it
    const schema: SettingsSchema = {
      settings: [
        { id: "min", label: "Min", type: "number", defaultValue: 1 },
        { id: "max", label: "Max", type: "number", defaultValue: 10 },
      ],
      tabs: [{ label: "Test", settingIds: ["min", "max"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, {
      clampFn: (settings: Record<string, unknown>) => {
        // Clamp min to not exceed max
        if ((settings.min as number) > (settings.max as number)) {
          settings.min = settings.max;
        }
      },
    });
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    // Set min higher than max — clampFn should bring it back down
    h.updateSetting("min", "20");
    expect(h.getSettings().min).toBe(10); // clamped to max
    expect(h.getSettings().max).toBe(10); // unchanged
  });

  it("calls onLoad after loadSettingsIntoMemory", () => {
    let loaded = false;
    const schema: SettingsSchema = {
      settings: [{ id: "val", label: "Val", type: "number", defaultValue: 5 }],
      tabs: [{ label: "Test", settingIds: ["val"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, {
      onLoad: () => {
        loaded = true;
      },
    });
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    expect(loaded).toBe(true);
  });

  it("serializes to env var after loadSettingsIntoMemory", () => {
    const schema: SettingsSchema = {
      settings: [{ id: "val", label: "Val", type: "number", defaultValue: 5 }],
      tabs: [{ label: "Test", settingIds: ["val"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    delete process.env.TEST_AUTO_SERIALIZE;
    const h = createSettingsExtension(schema, { envVar: "TEST_AUTO_SERIALIZE" });
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    expect(process.env.TEST_AUTO_SERIALIZE).toBe('{"val":5}');
    delete process.env.TEST_AUTO_SERIALIZE;
  });

  it("calls onLoad after env var path", () => {
    let loaded = false;
    const schema: SettingsSchema = {
      settings: [{ id: "val", label: "Val", type: "number", defaultValue: 5 }],
      tabs: [{ label: "Test", settingIds: ["val"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    process.env.TEST_ONLOAD_ENV = '{"val": 10}';
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, {
      onLoad: () => {
        loaded = true;
      },
      envVar: "TEST_ONLOAD_ENV",
    });
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    expect(loaded).toBe(true);
    delete process.env.TEST_ONLOAD_ENV;
  });

  it("falls back to defaults on malformed env var and still fires onLoad + re-serializes", () => {
    let loaded = false;
    const schema: SettingsSchema = {
      settings: [{ id: "val", label: "Val", type: "number", defaultValue: 5 }],
      tabs: [{ label: "Test", settingIds: ["val"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    process.env.TEST_MALFORMED = "{invalid json";
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, {
      onLoad: () => {
        loaded = true;
      },
      envVar: "TEST_MALFORMED",
    });
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    // Should fall back to defaults
    expect(h.getSettings().val).toBe(5);
    // onLoad should still fire
    expect(loaded).toBe(true);
    // Env var should be re-serialized with defaults
    expect(process.env.TEST_MALFORMED).toBe('{"val":5}');
    delete process.env.TEST_MALFORMED;
  });

  it("resolves valueAliases in updateSetting", () => {
    const schema: SettingsSchema = {
      settings: [
        {
          id: "mode",
          label: "Mode",
          type: "string",
          defaultValue: "general",
          presets: [
            ["general", "general"],
            ["comprehensive", "comprehensive"],
          ],
          valueAliases: { generic: "general", parallel: "comprehensive" },
        },
      ],
      tabs: [{ label: "Test", settingIds: ["mode"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    // First set to comprehensive, then use alias to set back to general
    h.updateSetting("mode", "comprehensive");
    expect(h.getSettings().mode).toBe("comprehensive");
    h.updateSetting("mode", "generic"); // alias → "general"
    expect(h.getSettings().mode).toBe("general");
  });

  it("resolves valueAlias to the null-pair label then sets null", () => {
    // valueAlias "auto" → "ask" → null pair → null
    const schema: SettingsSchema = {
      settings: [
        {
          id: "branch",
          label: "Branch",
          type: "string",
          defaultValue: null,
          presets: [
            ["ask", null],
            ["main", "main"],
          ],
          valueAliases: { auto: null },
        },
      ],
      tabs: [{ label: "Test", settingIds: ["branch"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    // First set to a non-null value
    h.updateSetting("branch", "main");
    expect(h.getSettings().branch).toBe("main");
    // Now use alias "auto" → resolves to null → null value
    h.updateSetting("branch", "auto");
    expect(h.getSettings().branch).toBeNull();
  });

  it("silently ignores updateSetting with unknown key", () => {
    const schema: SettingsSchema = {
      settings: [
        {
          id: "mode",
          label: "Mode",
          type: "string",
          defaultValue: "general",
          presets: [
            ["General", "general"],
            ["Comprehensive", "comprehensive"],
          ],
        },
      ],
      tabs: [{ label: "Test", settingIds: ["mode"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    const before = h.getSettings().mode;
    // Should not throw or change any setting
    h.updateSetting("nonExistentKey", "value");
    expect(h.getSettings().mode).toBe(before);
  });

  it("non-preset string values fall through to the type→parser registry", () => {
    // A setting with presets uses the registry parser when the input isn't a preset label/value
    const schema: SettingsSchema = {
      settings: [
        {
          id: "timeout",
          label: "Timeout",
          type: "duration",
          defaultValue: 300000,
          presets: [
            ["5m", 300000],
            ["10m", 600000],
            ["30m", 1800000],
          ],
        },
      ],
      tabs: [{ label: "Test", settingIds: ["timeout"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    // Preset value should work via presetLookup
    h.updateSetting("timeout", "10m");
    expect(h.getSettings().timeout).toBe(600000);
    // Non-preset value should fall through to the registry duration parser
    h.updateSetting("timeout", "7m");
    expect(h.getSettings().timeout).toBe(420000);
    // Invalid value should be rejected (no change)
    h.updateSetting("timeout", "invalid");
    expect(h.getSettings().timeout).toBe(420000);
  });

  it("null-pair label string and raw null both store null", () => {
    // Selecting the null-pair label ("Infinite") stores null via the gate's null-label step;
    // a raw null stores null directly. Neither touches the registry parser.
    const schema: SettingsSchema = {
      settings: [
        {
          id: "timeout",
          label: "Timeout",
          type: "duration",
          defaultValue: 300000,
          presets: [
            ["Infinite", null],
            ["5m", 300000],
          ],
        },
      ],
      tabs: [{ label: "Test", settingIds: ["timeout"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    // Set to a non-null value first
    h.updateSetting("timeout", "5000");
    expect(h.getSettings().timeout).toBe(5000);
    // Select the null-pair label string → null
    h.updateSetting("timeout", "Infinite");
    expect(h.getSettings().timeout).toBeNull();
    // Set a non-null value again, then a raw null → null
    h.updateSetting("timeout", "5000");
    expect(h.getSettings().timeout).toBe(5000);
    h.updateSetting("timeout", NO_VALUE);
    expect(h.getSettings().timeout).toBeNull();
  });

  it("non-nullable timeout rejects 'Infinite' (no silent null)", () => {
    // A non-nullable setting must NOT treat "Infinite" as null. This was a regression
    // when null-handling was generalized: the guard must only apply to nullable settings.
    const schema: SettingsSchema = {
      settings: [
        {
          id: "pollMs",
          label: "Poll",
          type: "duration",
          defaultValue: 30_000,
        },
      ],
      tabs: [{ label: "Test", settingIds: ["pollMs"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    h.updateSetting("pollMs", "Infinite");
    expect(h.getSettings().pollMs).toBe(30_000); // rejected → stays at default
    h.updateSetting("pollMs", "5000");
    expect(h.getSettings().pollMs).toBe(5000); // valid value accepted
  });

  it("null on non-nullable setting is silently rejected", () => {
    const schema: SettingsSchema = {
      settings: [
        {
          id: "pollMs",
          label: "Poll",
          type: "duration",
          defaultValue: 30_000,
        },
      ],
      tabs: [{ label: "Test", settingIds: ["pollMs"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    h.updateSetting("pollMs", NO_VALUE);
    expect(h.getSettings().pollMs).toBe(30_000); // null rejected: no null preset
  });

  it("boolean raw value is kept by the gate (boolean type)", () => {
    const schema: SettingsSchema = {
      settings: [
        {
          id: "enabled",
          label: "Enabled",
          type: "boolean",
          defaultValue: true,
          presets: [
            ["true", true],
            ["false", false],
          ],
        },
      ],
      tabs: [{ label: "Test", settingIds: ["enabled"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    h.updateSetting("enabled", SETTING_DISABLED);
    expect(h.getSettings().enabled).toBe(false);
    h.updateSetting("enabled", SETTING_ENABLED);
    expect(h.getSettings().enabled).toBe(true);
  });

  it("number type respects min:0 bounds (accepts 0, rejects -1)", () => {
    const schema: SettingsSchema = {
      settings: [{ id: "count", label: "Count", type: "number", defaultValue: 5, min: 0 }],
      tabs: [{ label: "Test", settingIds: ["count"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    // Zero is within min:0 → parsed and kept by the gate's bounds step
    h.updateSetting("count", "0");
    expect(h.getSettings().count).toBe(0);
    // Positive value should still work
    h.updateSetting("count", "10");
    expect(h.getSettings().count).toBe(10);
    // Negative is below min:0 → INVALID → no update
    h.updateSetting("count", "-1");
    expect(h.getSettings().count).toBe(10); // unchanged
  });

  it("clampFn is NOT called when updateSetting rejects invalid value", () => {
    let clampCalled = false;
    const schema: SettingsSchema = {
      settings: [
        {
          id: "mode",
          label: "Mode",
          type: "string",
          defaultValue: "general",
          presets: [
            ["General", "general"],
            ["Comprehensive", "comprehensive"],
          ],
        },
      ],
      tabs: [{ label: "Test", settingIds: ["mode"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension(schema, {
      clampFn: () => {
        clampCalled = true;
      },
    });
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    clampCalled = false; // reset after load
    // A non-string value fails the gate's type-match for a `string` setting → INVALID → no update.
    // (A stray string is intentionally KEPT — closed-enum enforcement is UI-only per)
    h.updateSetting("mode", 123);
    // clampFn should NOT have been called since didUpdate is false
    expect(clampCalled).toBe(false);
    expect(h.getSettings().mode).toBe("general"); // unchanged
  });

  it("updateSetting normalizes identically to load (number/duration/string)", () => {
    // The single gate serves both paths: a value set via updateSetting must equal what
    // normalizeFromSchema would produce for the same raw input.
    const schema: SettingsSchema = {
      settings: [
        { id: "count", label: "Count", type: "number", defaultValue: 0, min: 0 },
        { id: "timeout", label: "Timeout", type: "duration", defaultValue: 30_000 },
        { id: "mode", label: "Mode", type: "string", defaultValue: "off" },
      ],
      tabs: [{ label: "Test", settingIds: ["count", "timeout", "mode"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };

    const cases: [string, unknown][] = [
      ["count", "5"], // numeric string → 5
      ["count", -1], // below min:0 → default 0
      ["timeout", "5m"], // human duration → 300000
      ["timeout", "abc"], // invalid → default 30000
      ["mode", "on"], // identity string
      ["mode", 42], // wrong type → default "off"
    ];

    for (const [key, value] of cases) {
      delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
      const h = createSettingsExtension(schema, NO_OPTIONS);
      h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
      h.updateSetting(key, value);
      const viaUpdate = h.getSettings()[key];
      const viaLoad = normalizeFromSchema({ [key]: value }, schema)[key];
      expect(viaUpdate).toStrictEqual(viaLoad);
    }
  });

  it("createSettingsExtension<S> types getSettings/computeDefaults as S", () => {
    interface CountSettings {
      count: number;
    }
    const schema: SettingsSchema = {
      settings: [{ id: "count", label: "Count", type: "number", defaultValue: 7, min: 0 }],
      tabs: [{ label: "Test", settingIds: ["count"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    delete (globalThis as unknown as { __piSettings?: unknown }).__piSettings;
    const h = createSettingsExtension<CountSettings>(schema, NO_OPTIONS);
    h.loadSettingsIntoMemory("/tmp", NO_GLOBAL_DIR);
    // `count` is typed number; runtime set + read
    h.updateSetting("count", "9");
    const settings: CountSettings = h.getSettings();
    const value: number = settings.count;
    expect(value).toBe(9);
    const defaults: CountSettings = h.computeDefaults();
    const defaultValue: number = defaults.count;
    expect(defaultValue).toBe(7);
  });
});

// ── storage-levels model: stateless single-file mode + buffer env-var gating + level-opt ──
describe("storage-levels model", () => {
  const ENV = "PI_TEST_STORAGE_LEVELS";
  /** A schema whose global + project paths point at REAL temp files (per-test). */
  function schemaFor(globalFile: string, projectFile: string): SettingsSchema {
    return {
      settings: [
        { id: "count", label: "Count", type: "number", defaultValue: 3, min: 0 },
        {
          id: "mode",
          label: "Mode",
          type: "string",
          defaultValue: "a",
          presets: [
            ["A", "a"],
            ["B", "b"],
          ],
        },
      ],
      tabs: [{ label: "T", settingIds: ["count", "mode"] }],
      globalPath: () => globalFile,
      projectPath: () => projectFile,
    };
  }

  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "settings-ui-"));
    delete process.env[ENV];
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    delete process.env[ENV];
  });

  describe("stateless single-file mode (['global'])", () => {
    it("getSettings reads the file fresh on every call (cross-instance immediate)", () => {
      const file = join(tmp, "g.json");
      writeFileSync(file, JSON.stringify({ count: 11, mode: "b" }));
      const h = createSettingsExtension(schemaFor(file, file), { storageLevels: ["global"] });
      // no loadSettingsIntoMemory call — stateless reads the file directly
      expect(h.getSettings()).toEqual({ count: 11, mode: "b" });

      // a second instance (simulating another process) sees an external file edit immediately
      writeFileSync(file, JSON.stringify({ count: 42 }));
      expect(h.getSettings().count).toBe(42);
    });

    it("updateSetting does an immediate read-modify-write to the file (normalized)", () => {
      const file = join(tmp, "g.json");
      writeFileSync(file, JSON.stringify({ count: 5, mode: "b", staleKey: "legacy" }));
      const h = createSettingsExtension(schemaFor(file, file), { storageLevels: ["global"] });
      h.updateSetting("count", "9");
      const onDisk = JSON.parse(readFileSync(file, "utf-8"));
      expect(onDisk.count).toBe(9); // parsed to a number, not "9"
      expect(onDisk.mode).toBe("b"); // other SCHEMA key preserved
      expect(onDisk.staleKey).toBeUndefined(); // unknown key normalized away (full-rewrite)
      expect(h.getSettings().count).toBe(9); // visible on next fresh read
    });

    it("INVALID update does NOT write (gate applies to the read-modify-write)", () => {
      const file = join(tmp, "g.json");
      writeFileSync(file, JSON.stringify({ count: 5 }));
      const h = createSettingsExtension(schemaFor(file, file), { storageLevels: ["global"] });
      h.updateSetting("count", "-3"); // below min:0 → INVALID
      expect(JSON.parse(readFileSync(file, "utf-8")).count).toBe(5); // unchanged
    });

    it("the env var is NEVER read or written (even when envVar is set)", () => {
      const file = join(tmp, "g.json");
      writeFileSync(file, JSON.stringify({ count: 5 }));
      process.env[ENV] = JSON.stringify({ count: 999 });
      const h = createSettingsExtension(schemaFor(file, file), { storageLevels: ["global"], envVar: ENV });
      // stateless ignores the env var entirely — reads the file, not the env
      expect(h.getSettings().count).toBe(5);
      h.updateSetting("count", "7");
      expect(process.env[ENV]).toBe(JSON.stringify({ count: 999 })); // env var untouched
    });

    it("a file-mode read fills defaults for absent keys", () => {
      const file = join(tmp, "g.json");
      writeFileSync(file, "{}"); // empty file
      const h = createSettingsExtension(schemaFor(file, file), { storageLevels: ["global"] });
      expect(h.getSettings()).toEqual({ count: 3, mode: "a" }); // schema defaults
    });
  });

  describe("buffer mode env-var gating", () => {
    it("default (session+project+global): env var is serialized (session included)", () => {
      const h = createSettingsExtension(schemaFor(join(tmp, "g.json"), join(tmp, "p.json")), { envVar: ENV });
      h.loadSettingsIntoMemory(tmp, NO_GLOBAL_DIR);
      h.updateSetting("count", "9");
      expect(JSON.parse(process.env[ENV] ?? "{}").count).toBe(9);
    });

    it("['global','project'] (no session): env var is NOT serialized", () => {
      const h = createSettingsExtension(schemaFor(join(tmp, "g.json"), join(tmp, "p.json")), {
        storageLevels: ["global", "project"],
        envVar: ENV,
      });
      h.loadSettingsIntoMemory(tmp, NO_GLOBAL_DIR);
      h.updateSetting("count", "9");
      expect(process.env[ENV]).toBeUndefined();
    });
  });

  describe("updateSetting level-opt (surgical one-key write)", () => {
    it("{level:'project'} writes only that key to the project file (+ buffer sync)", () => {
      const gFile = join(tmp, "g.json");
      const pFile = join(tmp, "p.json");
      writeFileSync(gFile, JSON.stringify({ count: 100 }));
      writeFileSync(pFile, JSON.stringify({ mode: "b" }));
      const h = createSettingsExtension(schemaFor(gFile, pFile), {}); // buffer mode default
      h.loadSettingsIntoMemory(tmp, NO_GLOBAL_DIR);
      h.updateSetting("count", "9", { level: "project" });
      // project file gains count but keeps its existing mode
      expect(JSON.parse(readFileSync(pFile, "utf-8"))).toEqual({ mode: "b", count: 9 });
      // global file untouched
      expect(JSON.parse(readFileSync(gFile, "utf-8"))).toEqual({ count: 100 });
      // buffer reflects the change too
      expect(h.getSettings().count).toBe(9);
    });

    it("{level:'global'} writes only that key to the global file", () => {
      const gFile = join(tmp, "g.json");
      const pFile = join(tmp, "p.json");
      writeFileSync(gFile, JSON.stringify({ count: 100 }));
      writeFileSync(pFile, JSON.stringify({ count: 1 }));
      const h = createSettingsExtension(schemaFor(gFile, pFile), {});
      h.loadSettingsIntoMemory(tmp, NO_GLOBAL_DIR);
      h.updateSetting("count", "9", { level: "global" });
      expect(JSON.parse(readFileSync(gFile, "utf-8")).count).toBe(9);
      expect(JSON.parse(readFileSync(pFile, "utf-8")).count).toBe(1); // project untouched
    });

    it("{level:'session'} writes only the buffer (no file change)", () => {
      const gFile = join(tmp, "g.json");
      const pFile = join(tmp, "p.json");
      writeFileSync(gFile, JSON.stringify({ count: 100 }));
      const h = createSettingsExtension(schemaFor(gFile, pFile), {});
      h.loadSettingsIntoMemory(tmp, NO_GLOBAL_DIR);
      h.updateSetting("count", "9", { level: "session" });
      expect(h.getSettings().count).toBe(9); // buffer updated
      expect(JSON.parse(readFileSync(gFile, "utf-8")).count).toBe(100); // file untouched
    });

    it("the handle exposes its storageLevels (modal inherits it)", () => {
      const h = createSettingsExtension(schemaFor(join(tmp, "g.json"), join(tmp, "p.json")), {
        storageLevels: ["global"],
      });
      expect(h.storageLevels).toEqual(["global"]);
    });
  });

  it("stateless mode also works for ['project']", () => {
    const pFile = join(tmp, "p.json");
    writeFileSync(pFile, JSON.stringify({ count: 7 }));
    const h = createSettingsExtension(schemaFor(join(tmp, "g.json"), pFile), { storageLevels: ["project"] });
    expect(h.getSettings().count).toBe(7);
    h.updateSetting("count", "21");
    expect(JSON.parse(readFileSync(pFile, "utf-8")).count).toBe(21);
  });

  it("validateSchema rejects a malformed schema at creation (even in stateless mode)", () => {
    const bad: SettingsSchema = {
      settings: [{ id: "count", label: "Count", type: "number", defaultValue: 3 }],
      tabs: [], // orphan: 'count' not in any tab
      ...settingsFilePaths("x"),
    };
    expect(() => createSettingsExtension(bad, { storageLevels: ["global"] })).toThrow(
      /setting 'count' is not placed in any tab/,
    );
  });
});
