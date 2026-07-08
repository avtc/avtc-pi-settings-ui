// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { describe, expect, it } from "vitest";
import {
  buildPresetItems,
  buildPresetItemsFromPairs,
  computeRawInternalValue,
  normalizeFromSchema,
  normalizePresetElements,
  resolveEffectivePresets,
  resolveNullLabel,
  resolveNullLabelFromPairs,
  resolveStaticPresets,
  resolveValueAlias,
  validateSchema,
} from "../src/normalization.js";
import type { PresetPair, SettingSchema, SettingsSchema } from "../src/schema.js";
import { registerTypeDefinition, THINKING_LEVEL_PRESETS, type TypeDefinition } from "../src/type-definitions.js";

const testSchema: SettingsSchema = {
  settings: [
    {
      id: "timeout",
      label: "Timeout",
      type: "duration",
      defaultValue: 300_000,
    },
    {
      id: "mode",
      label: "Mode",
      type: "string",
      defaultValue: "off",
      presets: [
        ["Off", "off"],
        ["On", "on"],
      ],
    },
    { id: "count", label: "Count", type: "number", defaultValue: 3 },
    {
      id: "legacyMode",
      label: "Mode",
      type: "string",
      defaultValue: "off",
      aliases: ["oldMode", "deprecatedMode"],
    },
  ],
  tabs: [{ label: "Test", settingIds: ["timeout", "mode", "count", "legacyMode"] }],
  globalPath: () => "/tmp/test-global.json",
  projectPath: () => "/tmp/test-project.json",
};

describe("normalizeFromSchema", () => {
  it("fills defaults for missing fields", () => {
    const result = normalizeFromSchema({}, testSchema);
    expect(result.timeout).toBe(300_000);
    expect(result.mode).toBe("off");
    expect(result.count).toBe(3);
    expect(result.legacyMode).toBe("off");
  });

  it("preserves provided values", () => {
    const result = normalizeFromSchema({ timeout: 600_000, mode: "on" }, testSchema);
    expect(result.timeout).toBe(600_000);
    expect(result.mode).toBe("on");
    expect(result.count).toBe(3); // default
  });

  it("resolves aliases — first alias", () => {
    const result = normalizeFromSchema({ oldMode: "on" }, testSchema);
    expect(result.legacyMode).toBe("on");
  });

  it("resolves aliases — second alias", () => {
    const result = normalizeFromSchema({ deprecatedMode: "on" }, testSchema);
    expect(result.legacyMode).toBe("on");
  });

  it("prefers primary key over alias", () => {
    const result = normalizeFromSchema({ legacyMode: "on", oldMode: "off" }, testSchema);
    expect(result.legacyMode).toBe("on");
  });

  it("parses string values via the type→parser registry", () => {
    const result = normalizeFromSchema({ timeout: "600000" }, testSchema);
    expect(result.timeout).toBe(600000);
  });

  it("falls back to default when the type parser returns undefined", () => {
    const result = normalizeFromSchema({ timeout: "invalid" }, testSchema);
    expect(result.timeout).toBe(300_000);
  });

  it("rejects a string value not in the preset set — closed enum resets to default", () => {
    const result = normalizeFromSchema({ mode: "bogus" }, testSchema);
    expect(result.mode).toBe("off"); // not "bogus" — membership-checked against [off, on]
  });

  it("keeps a preset-less string free-form (no enum enforcement)", () => {
    const result = normalizeFromSchema({ legacyMode: "anything" }, testSchema);
    expect(result.legacyMode).toBe("anything"); // no presets → identity survives
  });

  it("preserves null from raw data as valid value (not replaced by default)", () => {
    const nullableSchema: SettingsSchema = {
      settings: [
        { id: "timeout", label: "Timeout", type: "duration", defaultValue: 300_000, presets: [["Infinite", null]] },
        { id: "concurrency", label: "Concurrency", type: "number", defaultValue: 6, presets: [["Infinite", null]] },
      ],
      tabs: [{ label: "Test", settingIds: ["timeout", "concurrency"] }],
      globalPath: () => "/tmp/test-global.json",
      projectPath: () => "/tmp/test-project.json",
    };
    const result = normalizeFromSchema({ timeout: null, concurrency: null }, nullableSchema);
    expect(result.timeout).toBeNull();
    expect(result.concurrency).toBeNull();
  });

  it("preserves null while filling defaults for missing fields", () => {
    const nullableSchema: SettingsSchema = {
      settings: [
        { id: "timeout", label: "Timeout", type: "duration", defaultValue: 300_000, presets: [["Infinite", null]] },
        { id: "count", label: "Count", type: "number", defaultValue: 3 },
      ],
      tabs: [{ label: "Test", settingIds: ["timeout", "count"] }],
      globalPath: () => "/tmp/test-global.json",
      projectPath: () => "/tmp/test-project.json",
    };
    const result = normalizeFromSchema({ timeout: null }, nullableSchema);
    expect(result.timeout).toBeNull();
    expect(result.count).toBe(3); // default filled
  });

  it("ignores unknown keys in raw", () => {
    const result = normalizeFromSchema({ unknownKey: "value" }, testSchema);
    expect(result.unknownKey).toBeUndefined();
  });
});

describe("valueAliases", () => {
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
        valueAliases: { generic: "general", "in-session": "general", parallel: "comprehensive" },
      },
    ],
    tabs: [{ label: "Test", settingIds: ["mode"] }],
    globalPath: () => "/tmp/test.json",
    projectPath: () => "/tmp/test.json",
  };

  it("resolves valueAliases during normalization", () => {
    const result = normalizeFromSchema({ mode: "generic" }, schema);
    expect(result.mode).toBe("general");
  });

  it("resolves valueAliases to non-aliased value", () => {
    const result = normalizeFromSchema({ mode: "parallel" }, schema);
    expect(result.mode).toBe("comprehensive");
  });

  it("passes through non-aliased values", () => {
    const result = normalizeFromSchema({ mode: "general" }, schema);
    expect(result.mode).toBe("general");
  });

  it("resolves valueAliases then parses via the type→parser registry", () => {
    const schemaWithParser: SettingsSchema = {
      settings: [
        {
          id: "count",
          label: "Count",
          type: "number",
          defaultValue: 0,
          valueAliases: { few: "3", many: "10" },
        },
      ],
      tabs: [{ label: "Test", settingIds: ["count"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    const result = normalizeFromSchema({ count: "few" }, schemaWithParser);
    expect(result.count).toBe(3); // few → "3" (alias) → 3 (registry number parser)
  });
});

describe("null pair in resolveValue", () => {
  it("converts the null-pair label string to null", () => {
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
            ["master", "master"],
            ["develop", "develop"],
          ],
        },
      ],
      tabs: [{ label: "Test", settingIds: ["branch"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    const result = normalizeFromSchema({ branch: "ask" }, schema);
    expect(result.branch).toBeNull();
  });

  it("resolves valueAliases then the null-pair label", () => {
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
            ["master", "master"],
            ["develop", "develop"],
          ],
          valueAliases: { auto: "ask" },
        },
      ],
      tabs: [{ label: "Test", settingIds: ["branch"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    const result = normalizeFromSchema({ branch: "auto" }, schema);
    expect(result.branch).toBeNull(); // auto → ask (alias) → null (null pair)
  });
});

describe("computeRawInternalValue", () => {
  it("converts number to string", () => {
    const setting = testSchema.settings[0];
    if (!setting) return; // timeout
    expect(computeRawInternalValue({ timeout: 300_000 }, setting)).toBe("300000");
  });

  it("converts null to Infinite when no custom sentinel", () => {
    const setting: SettingSchema = { id: "test", label: "Test", type: "duration", defaultValue: 0 };
    expect(computeRawInternalValue({ test: null }, setting)).toBe("Infinite");
  });

  it("converts undefined to sentinel", () => {
    const setting: SettingSchema = { id: "test", label: "Test", type: "duration", defaultValue: 0 };
    expect(computeRawInternalValue({}, setting)).toBe("Infinite");
  });
});

// Preset resolvers — `presets` pairs as single source.
// Regression guard: integer-index values (2,4,6,10) must not scramble label/value pairing.
describe("buildPresetItems (presets single source)", () => {
  const setting: SettingSchema = {
    id: "concurrency",
    label: "Concurrency",
    type: "number",
    defaultValue: 6,
    presets: [
      ["Infinite", null],
      ["2", 2],
      ["4", 4],
      ["6", 6],
      ["10", 10],
    ],
  };

  it("labels come from pairs in array order (Infinite first preserved)", () => {
    expect(buildPresetItems(setting).map((p) => p.label)).toEqual(["Infinite", "2", "4", "6", "10"]);
  });

  it("raw values are aligned with labels (6↔6, not 4)", () => {
    expect(buildPresetItems(setting).map((p) => p.rawValue)).toEqual([null, 2, 4, 6, 10]);
  });

  it("display values are serialized strings aligned with labels", () => {
    expect(buildPresetItems(setting).map((p) => p.displayValue)).toEqual(["Infinite", "2", "4", "6", "10"]);
  });

  it("null label derived from the null pair ('Infinite')", () => {
    expect(resolveNullLabel(setting)).toBe("Infinite");
  });

  it("computeRawInternalValue uses the derived null label", () => {
    expect(computeRawInternalValue({ concurrency: null }, setting)).toBe("Infinite");
    expect(computeRawInternalValue({ concurrency: 6 }, setting)).toBe("6");
  });
});

describe("resolveNullLabel variants", () => {
  it("derives 'Never' for a null pair on a duration setting", () => {
    const setting: SettingSchema = {
      id: "d",
      label: "D",
      type: "duration",
      defaultValue: null,
      presets: [
        ["Never", null],
        ["1d", 86_400_000],
      ],
    };
    expect(resolveNullLabel(setting)).toBe("Never");
    expect(buildPresetItems(setting).map((p) => p.rawValue)).toEqual([null, 86_400_000]);
    expect(buildPresetItems(setting).map((p) => p.displayValue)).toEqual(["Never", "86400000"]);
  });

  it("derives 'ask' for an enum null pair (baseBranch-style)", () => {
    const setting: SettingSchema = {
      id: "b",
      label: "B",
      type: "string",
      defaultValue: null,
      presets: [
        ["ask", null],
        ["main", "main"],
      ],
    };
    expect(resolveNullLabel(setting)).toBe("ask");
  });

  it("returns undefined for a non-nullable setting (no null pair, no nullSentinel)", () => {
    // A non-nullable timeout must NOT treat "Infinite" as null — resolveNullLabel signals
    // "not nullable" so guards skip null handling and parsers correctly reject "Infinite".
    const setting: SettingSchema = { id: "x", label: "X", type: "duration", defaultValue: 30_000 };
    expect(resolveNullLabel(setting)).toBeUndefined();
  });
});

describe("resolveValueAlias", () => {
  it("resolves a string alias to a string target", () => {
    const setting: SettingSchema = {
      id: "mode",
      label: "Mode",
      type: "string",
      defaultValue: "new",
      valueAliases: { old: "legacy" },
    };
    expect(resolveValueAlias("old", setting)).toBe("legacy");
  });

  it("resolves a string alias to a null target (e.g. baseBranch auto → null)", () => {
    const setting: SettingSchema = {
      id: "baseBranch",
      label: "Base Branch",
      type: "duration",
      defaultValue: null,
      presets: [
        ["ask", null],
        ["main", "main"],
      ],
      valueAliases: { auto: null },
    };
    expect(resolveValueAlias("auto", setting)).toBeNull();
  });

  it("resolves a string alias to a numeric target", () => {
    const setting: SettingSchema = {
      id: "count",
      label: "Count",
      type: "number",
      defaultValue: 3,
      valueAliases: { few: 1, many: 10 },
    };
    expect(resolveValueAlias("few", setting)).toBe(1);
    expect(resolveValueAlias("many", setting)).toBe(10);
  });

  it("returns the original value when no alias matches", () => {
    const setting: SettingSchema = {
      id: "mode",
      label: "Mode",
      type: "string",
      defaultValue: "new",
      valueAliases: { old: "legacy" },
    };
    expect(resolveValueAlias("new", setting)).toBe("new");
    expect(resolveValueAlias("unrelated", setting)).toBe("unrelated");
  });

  it("returns the original value when no valueAliases defined", () => {
    const setting: SettingSchema = { id: "x", label: "X", type: "string", defaultValue: "a" };
    expect(resolveValueAlias("a", setting)).toBe("a");
    expect(resolveValueAlias("anything", setting)).toBe("anything");
  });

  it("passes through non-string values unchanged (aliases are string-keyed)", () => {
    const setting: SettingSchema = {
      id: "mode",
      label: "Mode",
      type: "string",
      defaultValue: "new",
      valueAliases: { old: "legacy" },
    };
    expect(resolveValueAlias(42, setting)).toBe(42);
    expect(resolveValueAlias(null, setting)).toBeNull();
    expect(resolveValueAlias(true, setting)).toBe(true);
  });
});

// ── / — unified 8-step gate reset cases (the net-new steps) ────────
// Today's gate parses strings via the type→parser registry (5), then applies type-match
// (6), finite (7) and bounds (8). These cases assert that invalid raw values
// reset to the default on LOAD.

/** Build a single-setting schema for an isolated gate test. */
function singleSettingSchema(setting: SettingSchema): SettingsSchema {
  return {
    settings: [setting],
    tabs: [{ label: "Test", settingIds: [setting.id] }],
    globalPath: () => "/tmp/test.json",
    projectPath: () => "/tmp/test.json",
  };
}

describe("unified gate resets invalid raw values to default on load", () => {
  it("resets -1 (below min:0) to default", () => {
    const schema = singleSettingSchema({ id: "count", label: "Count", type: "number", defaultValue: 5, min: 0 });
    expect(normalizeFromSchema({ count: -1 }, schema).count).toBe(5);
  });

  it("resets 0 (below min:1) to default", () => {
    const schema = singleSettingSchema({ id: "n", label: "N", type: "number", defaultValue: 3, min: 1 });
    expect(normalizeFromSchema({ n: 0 }, schema).n).toBe(3);
  });

  it("resets NaN to default", () => {
    const schema = singleSettingSchema({ id: "count", label: "Count", type: "number", defaultValue: 5, min: 0 });
    expect(normalizeFromSchema({ count: NaN }, schema).count).toBe(5);
  });

  it("resets Infinity to default (finite check before bounds)", () => {
    const schema = singleSettingSchema({ id: "count", label: "Count", type: "number", defaultValue: 5, min: 0 });
    expect(normalizeFromSchema({ count: Infinity }, schema).count).toBe(5);
  });

  it("resets a raw boolean for a number setting to default", () => {
    const schema = singleSettingSchema({ id: "count", label: "Count", type: "number", defaultValue: 5, min: 0 });
    expect(normalizeFromSchema({ count: true }, schema).count).toBe(5);
    expect(normalizeFromSchema({ count: false }, schema).count).toBe(5);
  });

  it("resets a raw object/array for a number setting to default", () => {
    const schema = singleSettingSchema({ id: "count", label: "Count", type: "number", defaultValue: 5, min: 0 });
    expect(normalizeFromSchema({ count: {} }, schema).count).toBe(5);
    expect(normalizeFromSchema({ count: [] }, schema).count).toBe(5);
  });

  it("resets an empty string for a number setting to default", () => {
    const schema = singleSettingSchema({ id: "count", label: "Count", type: "number", defaultValue: 5, min: 0 });
    expect(normalizeFromSchema({ count: "" }, schema).count).toBe(5);
  });

  it("resets a non-null-label string for a timeout setting (no parser) to default", () => {
    const schema = singleSettingSchema({ id: "poll", label: "Poll", type: "duration", defaultValue: 30_000 });
    expect(normalizeFromSchema({ poll: "abc" }, schema).poll).toBe(30_000);
  });

  it("keeps a raw boolean for a boolean setting (type-match, not reset)", () => {
    const schema = singleSettingSchema({ id: "flag", label: "Flag", type: "boolean", defaultValue: true });
    expect(normalizeFromSchema({ flag: true }, schema).flag).toBe(true);
    expect(normalizeFromSchema({ flag: false }, schema).flag).toBe(false);
  });

  it("rejects null for a non-nullable type without a null-preset (: null only via null-preset)", () => {
    const schema = singleSettingSchema({ id: "t", label: "T", type: "duration", defaultValue: 300_000 });
    expect(normalizeFromSchema({ t: null }, schema).t).toBe(300_000);
  });

  it("preserves null for a null-preset setting", () => {
    const schema = singleSettingSchema({
      id: "branch",
      label: "Branch",
      type: "string",
      defaultValue: null as unknown as string,
      presets: [
        ["ask", null],
        ["main", "main"],
      ],
    });
    expect(normalizeFromSchema({ branch: null }, schema).branch).toBeNull();
  });

  it("parses a numeric string to a number (number type, min:0)", () => {
    const schema = singleSettingSchema({ id: "count", label: "Count", type: "number", defaultValue: 0, min: 0 });
    const result = normalizeFromSchema({ count: "5" }, schema).count;
    expect(result).toBe(5);
    expect(typeof result).toBe("number");
  });
});

// ──: a registered custom type is usable by a setting via the SAME gate path as built-ins ──
describe("custom types through the gate", () => {
  // Register a throwaway custom type once. Re-registration of the same id is idempotent.
  const customType: TypeDefinition<string> = {
    id: "gate-test-host-port",
    valueType: "string",
    parse: (input) => (/^[a-z]+:\d+$/.test(input) ? input : undefined),
    format: (value) => value,
    supportsCustomValues: true,
    errorMessage: "Enter host:port",
  };
  registerTypeDefinition(customType);

  it("keeps a valid custom-type value through normalizeFromSchema (same path as built-ins)", () => {
    const schema = singleSettingSchema({
      id: "endpoint",
      label: "Endpoint",
      type: "gate-test-host-port",
      defaultValue: "localhost:8080",
    });
    const result = normalizeFromSchema({ endpoint: "api:3000" }, schema).endpoint;
    expect(result).toBe("api:3000");
  });

  it("resets an invalid custom-type value to default through the gate", () => {
    const schema = singleSettingSchema({
      id: "endpoint",
      label: "Endpoint",
      type: "gate-test-host-port",
      defaultValue: "localhost:8080",
    });
    const result = normalizeFromSchema({ endpoint: "garbage" }, schema).endpoint;
    expect(result).toBe("localhost:8080"); // invalid parse → default
  });
});

// ── custom-type null handling: a type with no null-preset rejects null ──
describe("custom-type null handling", () => {
  it("resets a raw null to default for a custom type without a null-preset", () => {
    const nonNullableType: TypeDefinition<string> = {
      id: "gate-test-nonnullable",
      valueType: "string",
      parse: (input) => (input === "on" ? "on" : undefined),
      format: (value) => value,
      supportsCustomValues: false,
      errorMessage: "Enter on",
    };
    registerTypeDefinition(nonNullableType);
    const schema = singleSettingSchema({
      id: "toggle",
      label: "Toggle",
      type: "gate-test-nonnullable",
      defaultValue: "on",
    });
    // No null-preset → null is invalid → default.
    const result = normalizeFromSchema({ toggle: null }, schema).toggle;
    expect(result).toBe("on");
  });
});

// PresetsSource — a type-def may carry default `presets` (static array OR resolver function)
// that the setting's own `presets` overrides (replace, not merge). The gate resolves effective
// presets = setting.presets ?? typeDef.presets, treating resolver-functions as [] at load
// (the gate cannot call a resolver).
describe("type-def default presets via the gate seam", () => {
  // A throwaway type carrying STATIC default presets.
  const staticDefaultType: TypeDefinition<string> = {
    id: "gate-test-default-presets",
    valueType: "string",
    parse: (input, ctx) => {
      for (const [label, value] of ctx.presets) {
        if (label === input || String(value) === input) return value as string;
      }
      return undefined;
    },
    format: (value) => value,
    supportsCustomValues: false,
    errorMessage: "Select a value",
    presets: [
      ["a", "a"],
      ["b", "b"],
      ["None", null],
    ],
  };
  registerTypeDefinition(staticDefaultType);

  it("resolveEffectivePresets returns the type-def's static pairs when setting.presets is absent", () => {
    const setting: SettingSchema = { id: "x", label: "X", type: "gate-test-default-presets", defaultValue: "a" };
    const eff = resolveEffectivePresets(setting);
    expect(eff.isFunction).toBe(false);
    expect(eff.pairs).toEqual([
      ["a", "a"],
      ["b", "b"],
      ["None", null],
    ]);
  });

  it("resolveStaticPresets returns the type-def's pairs for the gate path", () => {
    const setting: SettingSchema = { id: "x", label: "X", type: "gate-test-default-presets", defaultValue: "a" };
    expect(resolveStaticPresets(setting)).toEqual([
      ["a", "a"],
      ["b", "b"],
      ["None", null],
    ]);
  });

  it("buildPresetItems derives presets from the type-def default (no setting.presets)", () => {
    const setting: SettingSchema = { id: "x", label: "X", type: "gate-test-default-presets", defaultValue: "a" };
    expect(buildPresetItems(setting).map((p) => p.label)).toEqual(["a", "b", "None"]);
    expect(buildPresetItems(setting).map((p) => p.rawValue)).toEqual(["a", "b", null]);
    expect(buildPresetItems(setting).map((p) => p.displayValue)).toEqual(["a", "b", "None"]);
  });

  it("resolveNullLabel finds the null pair from the type-def default", () => {
    const setting: SettingSchema = { id: "x", label: "X", type: "gate-test-default-presets", defaultValue: "a" };
    expect(resolveNullLabel(setting)).toBe("None");
  });

  it("end-to-end: a type-def DEFAULT null pair drives the gate's null-label→null conversion", () => {
    // The type-def carries presets with a ["None", null] pair; the setting declares NONE of its own.
    // The gate must read the type-def null pair through the seam: a stored "None" converts to null
    // at load (step 3), and null is valid (step 4 — nullLabel is defined). computeRawInternalValue
    // renders null back to "None" (not "Infinite") for display.
    const schema: SettingsSchema = {
      settings: [{ id: "pick", label: "Pick", type: "gate-test-default-presets", defaultValue: "a" }],
      tabs: [{ label: "T", settingIds: ["pick"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    const pickSetting = schema.settings[0];
    if (!pickSetting) return; // type guard
    expect(normalizeFromSchema({ pick: "None" }, schema).pick).toBeNull();
    expect(computeRawInternalValue({ pick: null }, pickSetting)).toBe("None");
  });

  it("setting.presets (static array) overrides the type-def default", () => {
    const setting: SettingSchema = {
      id: "x",
      label: "X",
      type: "gate-test-default-presets",
      defaultValue: "low",
      presets: [
        ["low", "low"],
        ["high", "high"],
      ],
    };
    const eff = resolveEffectivePresets(setting);
    expect(eff.pairs).toEqual([
      ["low", "low"],
      ["high", "high"],
    ]);
    expect(buildPresetItems(setting).map((p) => p.label)).toEqual(["low", "high"]);
    // No null pair in the override → not nullable.
    expect(resolveNullLabel(setting)).toBeUndefined();
  });
});

describe("type-def resolver-function presets are [] at the gate", () => {
  // A throwaway type carrying a FUNCTION default presets. The gate cannot call a resolver, so
  // it must treat the effective pairs as [] and isFunction=true (the UI resolves it at open).
  const resolverDefaultType: TypeDefinition<string> = {
    id: "gate-test-resolver-presets",
    valueType: "string",
    parse: (input) => input,
    format: (value) => value,
    supportsCustomValues: false,
    errorMessage: "Select a value",
    presets: (): PresetPair[] => [
      ["Default", null],
      ["a", "a"],
    ],
  };
  registerTypeDefinition(resolverDefaultType);

  it("resolveEffectivePresets flags isFunction and returns [] pairs", () => {
    const setting: SettingSchema = { id: "x", label: "X", type: "gate-test-resolver-presets", defaultValue: "a" };
    const eff = resolveEffectivePresets(setting);
    expect(eff.isFunction).toBe(true);
    expect(eff.pairs).toEqual([]);
  });

  it("buildPresetItems returns [] for a resolver default (gate treats resolver as empty)", () => {
    const setting: SettingSchema = { id: "x", label: "X", type: "gate-test-resolver-presets", defaultValue: "a" };
    expect(buildPresetItems(setting)).toEqual([]);
  });

  it("resolveNullLabel is undefined at the gate for a resolver default", () => {
    const setting: SettingSchema = { id: "x", label: "X", type: "gate-test-resolver-presets", defaultValue: "a" };
    expect(resolveNullLabel(setting)).toBeUndefined();
  });
});

// A resolver function may live on the SETTING itself (not just the type-def default).
// `PresetsSource` permits a function at either level; the gate treats a setting-level resolver
// identically to a type-def one — isFunction:true, [] pairs, undefined null label at load.
describe("setting-level resolver-function presets are [] at the gate", () => {
  it("resolveEffectivePresets flags isFunction and returns [] pairs for a setting-level resolver", () => {
    const setting: SettingSchema = {
      id: "x",
      label: "X",
      type: "string",
      defaultValue: "a",
      presets: (): PresetPair[] => [
        ["Default", null],
        ["a", "a"],
      ],
    };
    const eff = resolveEffectivePresets(setting);
    expect(eff.isFunction).toBe(true);
    expect(eff.pairs).toEqual([]);
  });

  it("buildPresetItems returns [] and resolveNullLabel is undefined for a setting-level resolver", () => {
    const setting: SettingSchema = {
      id: "x",
      label: "X",
      type: "string",
      defaultValue: "a",
      presets: (): PresetPair[] => [
        ["Default", null],
        ["a", "a"],
      ],
    };
    expect(buildPresetItems(setting)).toEqual([]);
    expect(resolveNullLabel(setting)).toBeUndefined();
  });

  it("a setting-level resolver overrides the type-def's STATIC default (setting wins)", () => {
    // gate-test-default-presets has static pairs; the setting overrides with a resolver.
    const setting: SettingSchema = {
      id: "x",
      label: "X",
      type: "gate-test-default-presets",
      defaultValue: "a",
      presets: (): PresetPair[] => [["dynamic", "dynamic"]],
    };
    const eff = resolveEffectivePresets(setting);
    expect(eff.isFunction).toBe(true);
    expect(eff.pairs).toEqual([]);
  });
});

describe("pair-only helpers (buildPresetItemsFromPairs / resolveNullLabelFromPairs)", () => {
  const pairs: PresetPair[] = [
    ["Default", null],
    ["low", "low"],
  ];

  it("resolveNullLabelFromPairs returns the null-pair label", () => {
    expect(resolveNullLabelFromPairs(pairs)).toBe("Default");
  });

  it("resolveNullLabelFromPairs returns undefined when no null pair", () => {
    expect(resolveNullLabelFromPairs([["a", "a"]])).toBeUndefined();
    expect(resolveNullLabelFromPairs([])).toBeUndefined();
  });

  it("buildPresetItemsFromPairs serializes pairs (null → its label)", () => {
    const items = buildPresetItemsFromPairs(pairs);
    expect(items.map((p) => p.label)).toEqual(["Default", "low"]);
    expect(items.map((p) => p.rawValue)).toEqual([null, "low"]);
    expect(items.map((p) => p.displayValue)).toEqual(["Default", "low"]);
  });
});

describe("thinking-level — load via the gate", () => {
  // A consumer writes only { type: "thinking-level" }; the type-def supplies THINKING_LEVEL_PRESETS
  // as its default presets (no setting.presets declared).
  function thinkingSchema(setting: Partial<SettingSchema>): SettingsSchema {
    return {
      settings: [
        {
          id: "thinking",
          label: "Thinking",
          type: "thinking-level",
          defaultValue: "medium",
          ...setting,
        } satisfies SettingSchema,
      ],
      tabs: [{ label: "T", settingIds: ["thinking"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
  }

  it("loads a stored valid level unchanged", () => {
    const out = normalizeFromSchema({ thinking: "high" }, thinkingSchema({}));
    expect(out.thinking).toBe("high");
  });

  it("loads the default when the stored value is invalid", () => {
    // 'bogus' is not one of the six levels → parse rejects it → the gate falls back to the default.
    const out = normalizeFromSchema({ thinking: "bogus" }, thinkingSchema({}));
    expect(out.thinking).toBe("medium");
  });

  it("loads the default when no value is stored", () => {
    const out = normalizeFromSchema({}, thinkingSchema({}));
    expect(out.thinking).toBe("medium");
  });

  it("accepts every shipped level", () => {
    for (const level of THINKING_LEVEL_PRESETS) {
      const out = normalizeFromSchema({ thinking: level[1] }, thinkingSchema({}));
      expect(out.thinking).toBe(level[1]);
    }
  });

  it("a per-setting presets override replaces the type-def default for that setting", () => {
    // Override narrows to only low/medium: a stored 'xhigh' (valid under the type-def default) is
    // now invalid under the override and falls back to the default.
    const schema = thinkingSchema({
      presets: [
        ["low", "low"],
        ["medium", "medium"],
      ],
    });
    expect(normalizeFromSchema({ thinking: "medium" }, schema).thinking).toBe("medium");
    expect(normalizeFromSchema({ thinking: "xhigh" }, schema).thinking).toBe("medium");
  });
});

// ── normalizePresetElements: friendly preset forms (bare values + mixed arrays) ──
describe("normalizePresetElements", () => {
  const num = (overrides: Partial<SettingSchema>): SettingSchema => ({
    id: "n",
    label: "N",
    type: "number",
    defaultValue: 1,
    ...overrides,
  });

  it("passes full PresetPairs through unchanged", () => {
    expect(
      normalizePresetElements(
        [
          ["low", 1],
          ["high", 10],
        ],
        num({}),
      ),
    ).toEqual([
      ["low", 1],
      ["high", 10],
    ]);
  });

  it("parses a bare duration string to ms via the type's parse", () => {
    const duration: SettingSchema = { id: "t", label: "T", type: "duration", defaultValue: 30_000 };
    expect(normalizePresetElements(["5m", "1h"], duration)).toEqual([
      ["5m", 300_000],
      ["1h", 3_600_000],
    ]);
  });

  it("treats a bare string as identity for a string type (label === value)", () => {
    const str: SettingSchema = { id: "mode", label: "Mode", type: "string", defaultValue: "a" };
    expect(normalizePresetElements(["a", "b", "c"], str)).toEqual([
      ["a", "a"],
      ["b", "b"],
      ["c", "c"],
    ]);
  });

  it("recognizes compact-threshold bare sentinels + thresholds (label === value)", () => {
    // "none"/"compact" are the type's off/force sentinels; "compact>NK" is the threshold form.
    // A consumer can declare the full vocabulary as a plain string array.
    const ct: SettingSchema = { id: "c", label: "C", type: "compact-threshold", defaultValue: "none" };
    expect(normalizePresetElements(["none", "compact", "compact>75K"], ct)).toEqual([
      ["none", "none"],
      ["compact", "compact"],
      ["compact>75K", "compact>75K"],
    ]);
  });

  it("pairs a bare number/boolean/null as [String(v), v]", () => {
    expect(normalizePresetElements([7, 14, 30], num({}))).toEqual([
      ["7", 7],
      ["14", 14],
      ["30", 30],
    ]);
    const bool: SettingSchema = { id: "b", label: "B", type: "boolean", defaultValue: true };
    expect(normalizePresetElements([true, false], bool)).toEqual([
      ["true", true],
      ["false", false],
    ]);
    // bare null → ["null", null]
    expect(normalizePresetElements([null], num({}))).toEqual([["null", null]]);
  });

  it("supports mixed arrays (pairs + bare values)", () => {
    const duration: SettingSchema = { id: "t", label: "T", type: "duration", defaultValue: 30_000 };
    expect(normalizePresetElements([["off", null], "5m", "10m"], duration)).toEqual([
      ["off", null],
      ["5m", 300_000],
      ["10m", 600_000],
    ]);
  });

  it("throws on an unparseable bare string (fail-fast at the resolution seam)", () => {
    const duration: SettingSchema = { id: "t", label: "T", type: "duration", defaultValue: 30_000 };
    expect(() => normalizePresetElements(["5m", "not-a-duration"], duration)).toThrow(
      /Setting 't': preset 'not-a-duration' is not a valid duration/,
    );
  });

  it("resolveStaticPresets normalizes bare values transparently (gate seam)", () => {
    const duration: SettingSchema = {
      id: "poll",
      label: "Poll",
      type: "duration",
      defaultValue: 30_000,
      presets: [["off", null], "30s", "5m"],
    };
    expect(resolveStaticPresets(duration)).toEqual([
      ["off", null],
      ["30s", 30_000],
      ["5m", 300_000],
    ]);
    // the null label is derived from the resolved pairs (the bare values had no null)
    expect(resolveNullLabel(duration)).toBe("off");
  });
});

// ── validateSchema: structural integrity at registration (fail-fast) ──
describe("validateSchema", () => {
  const baseSetting: SettingSchema = { id: "n", label: "N", type: "number", defaultValue: 1 };
  const tabbedSchema = (
    settings: SettingSchema[],
    tabs: { label: string; settingIds: string[] }[],
  ): SettingsSchema => ({
    settings,
    tabs,
    globalPath: () => "/tmp/test.json",
    projectPath: () => "/tmp/test.json",
  });

  it("accepts a well-formed schema (every setting in a tab; every id resolves)", () => {
    const schema = tabbedSchema(
      [baseSetting, { id: "t", label: "T", type: "duration", defaultValue: 30_000 }],
      [{ label: "All", settingIds: ["n", "t"] }],
    );
    expect(() => validateSchema(schema)).not.toThrow();
  });

  it("throws when a setting is not placed in any tab (orphan)", () => {
    const schema = tabbedSchema(
      [baseSetting, { id: "orphan", label: "Orphan", type: "number", defaultValue: 0 }],
      [{ label: "Tab", settingIds: ["n"] }], // 'orphan' unreferenced
    );
    expect(() => validateSchema(schema)).toThrow(/setting 'orphan' is not placed in any tab/);
  });

  it("throws when a tab references an unknown setting (unresolved id)", () => {
    const schema = tabbedSchema(
      [baseSetting],
      [
        { label: "Tab", settingIds: ["n", "ghost"] }, // 'ghost' undefined
      ],
    );
    expect(() => validateSchema(schema)).toThrow(/tab 'Tab' references unknown setting 'ghost'/);
  });

  it("throws on a duplicate setting id", () => {
    const schema = tabbedSchema([baseSetting, { ...baseSetting }], [{ label: "Tab", settingIds: ["n"] }]);
    expect(() => validateSchema(schema)).toThrow(/duplicate setting id 'n'/);
  });

  it("throws on an unparseable bare preset string (eager, before structure checks pass-through)", () => {
    const schema = tabbedSchema(
      [{ id: "t", label: "T", type: "duration", defaultValue: 30_000, presets: ["5m", "bogus"] }],
      [{ label: "Tab", settingIds: ["t"] }],
    );
    expect(() => validateSchema(schema)).toThrow(/Setting 't': preset 'bogus' is not a valid duration/);
  });

  it("createSettingsExtension runs validateSchema at registration", async () => {
    const { createSettingsExtension } = await import("../src/factory.js");
    const orphan = tabbedSchema(
      [baseSetting, { id: "x", label: "X", type: "number", defaultValue: 0 }],
      [{ label: "Tab", settingIds: ["n"] }],
    );
    expect(() => createSettingsExtension(orphan, {})).toThrow(/setting 'x' is not placed in any tab/);
  });
});
