// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Tests for buildSchemaTabGroups.
 *
 * Verifies the conversion from SettingsSchema + settings values
 * into TabDefinition[] format with proper display formatting.
 */

import { describe, expect, it } from "vitest";
import type { PresetPair, SettingsSchema } from "../src/schema.js";
import { buildSchemaTabGroups } from "../src/ui/schema-tabs.js";

const TEST_SCHEMA: SettingsSchema = {
  settings: [
    {
      id: "timeoutMs",
      label: "Timeout",
      type: "duration",
      defaultValue: 300000,
      presets: [
        ["Infinite", null],
        ["5m", 300000],
      ],
      description: "Test timeout",
    },
    {
      id: "durationDays",
      label: "Duration",
      type: "duration",
      defaultValue: 86400000,
      presets: [
        ["Infinite", null],
        ["1d", 86400000],
      ],
      description: "Test duration",
    },
    {
      id: "enumSetting",
      label: "Enum",
      type: "string",
      defaultValue: "a",
      presets: [
        ["a", "a"],
        ["b", "b"],
        ["c", "c"],
      ],
      description: "Test enum",
    },
    {
      id: "presetSetting",
      label: "Preset",
      type: "number",
      min: 1,
      defaultValue: 3,
      presets: [
        ["1 pass", 1],
        ["3 passes", 3],
        ["5 passes", 5],
      ],
      description: "Test preset",
    },
    {
      id: "compactThreshold",
      label: "Compact",
      type: "compact-threshold",
      defaultValue: "100",
      description: "Test compact",
    },
  ],
  tabs: [
    {
      label: "Test",
      settingIds: ["timeoutMs", "durationDays", "enumSetting", "presetSetting", "compactThreshold"],
    },
  ],
  globalPath: () => "/tmp/test.json",
  projectPath: () => "/tmp/test.json",
};

describe("buildSchemaTabGroups", () => {
  it("returns tabs with correct labels", () => {
    const settings = {
      timeoutMs: 300000,
      durationDays: 86400000,
      enumSetting: "a",
      presetSetting: 3,
      compactThreshold: "compact>100K",
    };
    const tabs = buildSchemaTabGroups(settings, TEST_SCHEMA, null);
    expect(tabs.length).toBe(1);
    expect(tabs[0].label).toBe("Test");
  });

  it("formats duration as human-readable", () => {
    const settings = {
      timeoutMs: 300000,
      durationDays: 86400000,
      enumSetting: "a",
      presetSetting: 3,
      compactThreshold: "compact>100K",
    };
    const tabs = buildSchemaTabGroups(settings, TEST_SCHEMA, null);
    const timeout = tabs[0].settings.find((s) => s.id === "timeoutMs");
    expect(timeout).toBeDefined();
    expect(timeout?.value).toBe("300000");
    expect(timeout?.displayValue).toBe("5m");
  });

  it("formats null timeout as Infinite", () => {
    const settings = {
      timeoutMs: null,
      durationDays: 86400000,
      enumSetting: "a",
      presetSetting: 3,
      compactThreshold: "compact>100K",
    };
    const tabs = buildSchemaTabGroups(settings, TEST_SCHEMA, null);
    const timeout = tabs[0].settings.find((s) => s.id === "timeoutMs");
    expect(timeout).toBeDefined();
    expect(timeout?.value).toBe("Infinite");
    expect(timeout?.displayValue).toBe("Infinite");
  });

  it("formats duration as human-readable", () => {
    const settings = {
      timeoutMs: 300000,
      durationDays: 172800000, // 2 days
      enumSetting: "a",
      presetSetting: 3,
      compactThreshold: "compact>100K",
    };
    const tabs = buildSchemaTabGroups(settings, TEST_SCHEMA, null);
    const duration = tabs[0].settings.find((s) => s.id === "durationDays");
    expect(duration).toBeDefined();
    expect(duration?.value).toBe("172800000");
    expect(duration?.displayValue).toBe("2d");
  });

  it("formats null duration as Infinite", () => {
    const settings = {
      timeoutMs: 300000,
      durationDays: null,
      enumSetting: "a",
      presetSetting: 3,
      compactThreshold: "compact>100K",
    };
    const tabs = buildSchemaTabGroups(settings, TEST_SCHEMA, null);
    const duration = tabs[0].settings.find((s) => s.id === "durationDays");
    expect(duration).toBeDefined();
    expect(duration?.value).toBe("Infinite");
    expect(duration?.displayValue).toBe("Infinite");
  });

  it("includes enum preset values array", () => {
    const settings = {
      timeoutMs: 300000,
      durationDays: 86400000,
      enumSetting: "a",
      presetSetting: 3,
      compactThreshold: "compact>100K",
    };
    const tabs = buildSchemaTabGroups(settings, TEST_SCHEMA, null);
    const enumSetting = tabs[0].settings.find((s) => s.id === "enumSetting");
    expect(enumSetting).toBeDefined();
    expect(enumSetting?.presets?.map((p) => p.rawValue)).toEqual(["a", "b", "c"]);
  });

  it("formats preset setting with presetLabels mapping", () => {
    const settings = {
      timeoutMs: 300000,
      durationDays: 86400000,
      enumSetting: "a",
      presetSetting: 3,
      compactThreshold: "compact>100K",
    };
    const tabs = buildSchemaTabGroups(settings, TEST_SCHEMA, null);
    const preset = tabs[0].settings.find((s) => s.id === "presetSetting");
    expect(preset).toBeDefined();
    expect(preset?.value).toBe("3");
    // displayValue comes from preset label lookup (value "3" → label "3 passes")
    expect(preset?.displayValue).toBe("3 passes");
    expect(preset?.presets?.map((p) => p.label)).toEqual(["1 pass", "3 passes", "5 passes"]);
    expect(preset?.presets?.map((p) => p.rawValue)).toEqual([1, 3, 5]);
  });

  it("formats compact-threshold correctly", () => {
    const settings = {
      timeoutMs: 300000,
      durationDays: 86400000,
      enumSetting: "a",
      presetSetting: 3,
      compactThreshold: "compact>100K",
    };
    const tabs = buildSchemaTabGroups(settings, TEST_SCHEMA, null);
    const compact = tabs[0].settings.find((s) => s.id === "compactThreshold");
    expect(compact).toBeDefined();
    expect(compact?.value).toBe("compact>100K");
    expect(compact?.displayValue).toBe("compact>100K");
  });

  it("formats built-in duration type as human form", () => {
    const schema: SettingsSchema = {
      settings: [{ id: "dur", label: "Dur", type: "duration", defaultValue: 30000, description: "d" }],
      tabs: [{ label: "T", settingIds: ["dur"] }],
      globalPath: () => "/tmp/t.json",
      projectPath: () => "/tmp/t.json",
    };
    const tabs = buildSchemaTabGroups({ dur: 30000 }, schema, null);
    const dur = tabs[0].settings.find((s) => s.id === "dur");
    // : duration values render as human form ("30s"), not raw ms ("30000").
    expect(dur?.value).toBe("30000");
    expect(dur?.displayValue).toBe("30s");
  });

  it("includes all declared tab settings", () => {
    const settings = {
      timeoutMs: 300000,
      durationDays: 86400000,
      enumSetting: "a",
      presetSetting: 3,
      compactThreshold: "compact>100K",
    };
    const tabs = buildSchemaTabGroups(settings, TEST_SCHEMA, null);
    // uiVisible was removed — every setting declared in a tab is shown.
    expect(tabs[0].settings.length).toBe(5);
  });

  it("skips unknown settingIds gracefully", () => {
    const schema = {
      ...TEST_SCHEMA,
      tabs: [{ label: "Test", settingIds: ["unknownSetting"] }],
    };
    const settings = {};
    const tabs = buildSchemaTabGroups(settings, schema, null);
    expect(tabs[0].settings.length).toBe(0);
  });
});

describe("buildSchemaTabGroups with resolved function-presets", () => {
  /** A setting whose `presets` is a function — its resolved pairs arrive via the 3rd param. */
  function resolverSchema(): SettingsSchema {
    return {
      settings: [
        {
          id: "pick",
          label: "Pick",
          type: "string",
          defaultValue: "a",
          // Effective source is a function; the gate sees [] and the UI receives resolved pairs.
          presets: (): PresetPair[] => [
            ["Default", null],
            ["a", "a"],
          ],
        },
      ],
      tabs: [{ label: "T", settingIds: ["pick"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
  }

  it("renders resolved pairs for a function-presets setting", () => {
    const schema = resolverSchema();
    const resolvedPairs = new Map<string, PresetPair[]>([
      [
        "pick",
        [
          ["Default", null],
          ["a", "a"],
        ],
      ],
    ]);

    const tabs = buildSchemaTabGroups({ pick: "a" }, schema, resolvedPairs);

    const item = tabs[0].settings.find((s) => s.id === "pick");
    if (!item) throw new Error("setting 'pick' not found");
    if (!item.presets) throw new Error("presets missing");
    expect(item.presets.map((p) => p.label)).toEqual(["Default", "a"]);
    // The null pair's serialized displayValue is its own label ("Default"), since a null pair is
    // its own null label — not the static "Infinite" fallback.
    expect(item.presets.map((p) => p.displayValue)).toEqual(["Default", "a"]);
  });

  it("a function-presets setting with NO resolved entry builds an empty preset list", () => {
    // A resolver that threw/rejected yields [] — the UI still builds (no crash), just no presets.
    const schema = resolverSchema();
    const resolvedPairs = new Map<string, PresetPair[]>([["pick", []]]);

    const tabs = buildSchemaTabGroups({ pick: "a" }, schema, resolvedPairs);

    const item = tabs[0].settings.find((s) => s.id === "pick");
    expect(item?.presets).toEqual([]);
  });

  it("threads the resolved null label so a null value shows 'Default', not 'Infinite'", () => {
    // A null value for a function-presets setting: computeRawInternalValue yields the static
    // "Infinite" fallback (the resolver's null label is unknown to it). The resolved ["Default", null]
    // pair overrides the display to "Default" so a null model reads "Default", not "Infinite".
    const schema = resolverSchema();
    const resolvedPairs = new Map<string, PresetPair[]>([
      [
        "pick",
        [
          ["Default", null],
          ["a", "a"],
        ],
      ],
    ]);

    const tabs = buildSchemaTabGroups({ pick: null }, schema, resolvedPairs);

    const item = tabs[0].settings.find((s) => s.id === "pick");
    expect(item?.value).toBe("Default");
    expect(item?.displayValue).toBe("Default");
  });

  it("a function-presets setting whose resolved pairs have NO null pair keeps 'Infinite'", () => {
    // No null pair in the resolved list → no resolved null label → the raw "Infinite" stands.
    const schema = resolverSchema();
    const resolvedPairs = new Map<string, PresetPair[]>([
      [
        "pick",
        [
          ["a", "a"],
          ["b", "b"],
        ],
      ],
    ]);

    const tabs = buildSchemaTabGroups({ pick: null }, schema, resolvedPairs);

    const item = tabs[0].settings.find((s) => s.id === "pick");
    expect(item?.value).toBe("Infinite");
  });

  it("static-array presets are byte-for-byte unchanged when resolvedPairs is null", () => {
    const settings = {
      timeoutMs: 300000,
      durationDays: 86400000,
      enumSetting: "a",
      presetSetting: 3,
      compactThreshold: "compact>100K",
    };
    const tabsA = buildSchemaTabGroups(settings, TEST_SCHEMA, null);
    const tabsB = buildSchemaTabGroups(settings, TEST_SCHEMA, null);
    // Static presets come from the WeakMap cache; passing null must not change them.
    expect(tabsA[0].settings.map((s) => s.presets)).toEqual(tabsB[0].settings.map((s) => s.presets));
  });

  it("a function-presets setting with resolvedPairs=null builds an empty preset list (defensive)", () => {
    // No open-time map → function presets have nothing to render → empty list, no crash.
    const schema = resolverSchema();

    const tabs = buildSchemaTabGroups({ pick: "a" }, schema, null);

    const item = tabs[0].settings.find((s) => s.id === "pick");
    expect(item?.presets).toEqual([]);
  });

  it("a function-presets setting with resolvedPairs=null and a null value keeps 'Infinite'", () => {
    const schema = resolverSchema();

    const tabs = buildSchemaTabGroups({ pick: null }, schema, null);

    const item = tabs[0].settings.find((s) => s.id === "pick");
    expect(item?.value).toBe("Infinite");
  });

  it("does not mistake a literal 'Infinite' string value for a null (structural null check)", () => {
    // A function-presets setting whose value is the literal string "Infinite" (not null) must
    // NOT trigger the resolved null-label override — only an actual null/undefined does.
    const schema = resolverSchema();
    const resolvedPairs = new Map<string, PresetPair[]>([
      [
        "pick",
        [
          ["Default", null],
          ["a", "a"],
        ],
      ],
    ]);

    const tabs = buildSchemaTabGroups({ pick: "Infinite" }, schema, resolvedPairs);

    const item = tabs[0].settings.find((s) => s.id === "pick");
    // The value stays the literal "Infinite" — not overridden to "Default".
    expect(item?.value).toBe("Infinite");
  });
});
