// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureCtx } from "../src/ctx-store.js";
import type { PresetPair } from "../src/schema.js";
import type { TypeContext, TypeDefinition } from "../src/type-definitions.js";
import {
  coerceTypedValue,
  formatRawForDisplay,
  getTypeDefinition,
  registerTypeDefinition,
  THINKING_LEVEL_PRESETS,
} from "../src/type-definitions.js";

/** An empty context used for built-ins that don't consult presets/bounds. */
const EMPTY_CTX: TypeContext = { presets: [] };

describe("getTypeDefinition — 7 built-ins registered", () => {
  it.each([
    "number",
    "duration",
    "compact-threshold",
    "string",
    "boolean",
    "thinking-level",
    "model",
  ])("returns the %s type", (id) => {
    expect(getTypeDefinition(id).id).toBe(id);
  });

  it("throws for an unknown type id", () => {
    expect(() => getTypeDefinition("does-not-exist")).toThrow(/Unknown setting type/);
  });
});

describe("number type", () => {
  const t = getTypeDefinition("number");

  it("parses any integer including negatives and zero (does not floor/clamp)", () => {
    expect(t.parse("5", EMPTY_CTX)).toBe(5);
    expect(t.parse("0", EMPTY_CTX)).toBe(0);
    expect(t.parse("-3", EMPTY_CTX)).toBe(-3);
    expect(t.parse("42", EMPTY_CTX)).toBe(42);
  });

  it("returns undefined for non-integers and garbage", () => {
    expect(t.parse("1.5", EMPTY_CTX)).toBeUndefined();
    expect(t.parse("abc", EMPTY_CTX)).toBeUndefined();
    expect(t.parse("", EMPTY_CTX)).toBeUndefined();
  });

  it("formats as a plain string", () => {
    expect(t.format(5, EMPTY_CTX)).toBe("5");
    expect(t.format(0, EMPTY_CTX)).toBe("0");
    expect(t.format(-3, EMPTY_CTX)).toBe("-3");
  });

  it("is bounded and supports custom values", () => {
    expect(t.bounded).toBe(true);
    expect(t.supportsCustomValues).toBe(true);
  });
});

describe("duration type", () => {
  const t = getTypeDefinition("duration");

  it("parses human durations", () => {
    expect(t.parse("30s", EMPTY_CTX)).toBe(30_000);
    expect(t.parse("5m", EMPTY_CTX)).toBe(300_000);
    expect(t.parse("7d", EMPTY_CTX)).toBe(604_800_000);
  });

  it("keeps the bare-ms Number fallback so a plain numeric string still parses", () => {
    expect(t.parse("300000", EMPTY_CTX)).toBe(300000);
  });

  it("returns undefined for invalid input", () => {
    expect(t.parse("abc", EMPTY_CTX)).toBeUndefined();
  });

  it("parses zero as a valid duration (range rejection is the gate's job via min)", () => {
    expect(t.parse("0s", EMPTY_CTX)).toBe(0);
    expect(t.parse("0ms", EMPTY_CTX)).toBe(0);
    expect(t.parse("0", EMPTY_CTX)).toBe(0);
  });

  it("formats ms as human duration", () => {
    expect(t.format(30_000, EMPTY_CTX)).toBe("30s");
    expect(t.format(604_800_000, EMPTY_CTX)).toBe("7d");
  });

  it("is bounded and supports custom values", () => {
    expect(t.bounded).toBe(true);
    expect(t.supportsCustomValues).toBe(true);
  });
});

describe("compact-threshold type", () => {
  // A representative todo-like context: "none" preset + a custom compact preset
  const ctx: TypeContext = {
    presets: [
      ["none", "none"],
      ["compact>75K", "compact>75K"],
    ],
  };
  const t = getTypeDefinition("compact-threshold");

  it("matches a preset value", () => {
    expect(t.parse("none", ctx)).toBe("none");
    expect(t.parse("compact>75K", ctx)).toBe("compact>75K");
  });

  it("accepts an already-canonical compact>NK value", () => {
    expect(t.parse("compact>200K", ctx)).toBe("compact>200K");
  });

  it("recognizes the off/force sentinels even without preset context (bare-string presets)", () => {
    // Empty-presets ctx is what normalizePresetElements uses when pairing bare preset strings.
    const emptyCtx: TypeContext = { presets: [] };
    expect(t.parse("none", emptyCtx)).toBe("none");
    expect(t.parse("compact", emptyCtx)).toBe("compact");
    expect(t.parse("compact>75K", emptyCtx)).toBe("compact>75K");
  });

  it("turns a numeric string into compact>NK", () => {
    expect(t.parse("300", ctx)).toBe("compact>300K");
  });

  it("returns undefined for garbage", () => {
    expect(t.parse("abc", ctx)).toBeUndefined();
    expect(t.parse("", ctx)).toBeUndefined();
  });

  it("prefills the custom input with just the number", () => {
    expect(t.toInputPrefill?.("compact>300K", ctx)).toBe("300");
    expect(t.toInputPrefill?.("none", ctx)).toBe("");
  });

  it("formats the raw value as-is", () => {
    expect(t.format("compact>300K", ctx)).toBe("compact>300K");
    expect(t.format("none", ctx)).toBe("none");
  });

  it("is not bounded", () => {
    expect(t.bounded).toBeFalsy();
  });
});

describe("string type", () => {
  const t = getTypeDefinition("string");

  it("is identity when no presets — free-form values survive", () => {
    expect(t.parse("trunk", EMPTY_CTX)).toBe("trunk");
    expect(t.parse("anything-here", EMPTY_CTX)).toBe("anything-here");
    expect(t.parse("", EMPTY_CTX)).toBe("");
  });

  it("enforces a closed enum when presets exist — matches a preset's label or raw value", () => {
    const ctx: TypeContext = {
      presets: [
        ["Agent", "agent"],
        ["Background", "background"],
        ["Off", "none"],
      ],
    };
    expect(t.parse("agent", ctx)).toBe("agent"); // raw value match
    expect(t.parse("Agent", ctx)).toBe("agent"); // label match → its raw value
    expect(t.parse("none", ctx)).toBe("none");
  });

  it("rejects a value not in the preset set when presets exist (returns undefined → default)", () => {
    const ctx: TypeContext = {
      presets: [
        ["Agent", "agent"],
        ["Background", "background"],
      ],
    };
    expect(t.parse("bogus", ctx)).toBeUndefined();
    expect(t.parse("", ctx)).toBeUndefined();
  });

  it("formats as-is", () => {
    expect(t.format("trunk", EMPTY_CTX)).toBe("trunk");
  });

  it("does not support custom values (enums are enforced UI-side)", () => {
    expect(t.supportsCustomValues).toBe(false);
  });
});

describe("boolean type", () => {
  const t = getTypeDefinition("boolean");

  it("parses true/false strings", () => {
    expect(t.parse("true", EMPTY_CTX)).toBe(true);
    expect(t.parse("false", EMPTY_CTX)).toBe(false);
  });

  it("returns undefined for non-boolean strings", () => {
    expect(t.parse("yes", EMPTY_CTX)).toBeUndefined();
    expect(t.parse("1", EMPTY_CTX)).toBeUndefined();
    expect(t.parse("", EMPTY_CTX)).toBeUndefined();
  });

  it("formats true/false as strings", () => {
    expect(t.format(true, EMPTY_CTX)).toBe("true");
    expect(t.format(false, EMPTY_CTX)).toBe("false");
  });

  it("is not bounded", () => {
    expect(t.bounded).toBeFalsy();
  });
});

describe("thinking-level type", () => {
  // The gate builds the parse context from the EFFECTIVE static presets:
  // setting.presets ?? type-def default. With no setting override, that is the type-def's own
  // THINKING_LEVEL_PRESETS — the consumer writes only { type: "thinking-level" }.
  const presets: readonly PresetPair[] = THINKING_LEVEL_PRESETS;
  const ctx: TypeContext = { presets };
  const t = getTypeDefinition("thinking-level");

  it("ships THINKING_LEVEL_PRESETS as its default presets (6 levels, label = value)", () => {
    expect(THINKING_LEVEL_PRESETS).toEqual([
      ["off", "off"],
      ["minimal", "minimal"],
      ["low", "low"],
      ["medium", "medium"],
      ["high", "high"],
      ["xhigh", "xhigh"],
    ]);
    expect(t.presets).toEqual(THINKING_LEVEL_PRESETS);
  });

  it("is a string type with no custom values", () => {
    expect(t.valueType).toBe("string");
    expect(t.supportsCustomValues).toBe(false);
  });

  it("parses a known level", () => {
    expect(t.parse("off", ctx)).toBe("off");
    expect(t.parse("medium", ctx)).toBe("medium");
    expect(t.parse("xhigh", ctx)).toBe("xhigh");
  });

  it("rejects an unknown level (returns undefined → load falls back to default)", () => {
    expect(t.parse("bogus", ctx)).toBeUndefined();
    expect(t.parse("Medium", ctx)).toBeUndefined(); // case-sensitive (membership is exact)
    expect(t.parse("", ctx)).toBeUndefined();
  });

  it("formats the value as-is", () => {
    expect(t.format("high", ctx)).toBe("high");
  });
});

describe("model type", () => {
  const t = getTypeDefinition("model");
  // The captured ctx is a singleton — reset it around this block so other blocks' captures do not
  // leak in, and so this block's fake registry does not leak out.
  beforeEach(() => captureCtx({}));
  afterEach(() => captureCtx({}));

  /** A fake registry whose `find` returns a model for known provider/id pairs. */
  function registryWith(models: Array<{ id: string; provider: string }>) {
    return {
      find: (provider: string, id: string) => models.find((m) => m.provider === provider && m.id === id),
      getAvailable: () => models,
      getError: () => undefined,
      refresh: () => {},
    };
  }

  it("parses a provider/id value as-is (identity — stale ids still load)", () => {
    expect(t.parse("anthropic/claude-3-5-sonnet", EMPTY_CTX)).toBe("anthropic/claude-3-5-sonnet");
    expect(t.parse("stale-provider/some-id", EMPTY_CTX)).toBe("stale-provider/some-id");
  });

  it("offers no custom values", () => {
    expect(t.supportsCustomValues).toBe(false);
  });

  it("formats a known provider/id as 'id [provider]' via the captured registry", () => {
    captureCtx({
      modelRegistry: registryWith([{ id: "claude-3-5-sonnet", provider: "anthropic" }]) as unknown as ModelRegistry,
    });
    expect(t.format("anthropic/claude-3-5-sonnet", EMPTY_CTX)).toBe("claude-3-5-sonnet [anthropic]");
  });

  it("renders a stale provider/id verbatim when the registry has no match", () => {
    captureCtx({ modelRegistry: registryWith([]) as unknown as ModelRegistry });
    expect(t.format("stale/id", EMPTY_CTX)).toBe("stale/id");
  });

  it("renders the raw value when no registry was captured", () => {
    captureCtx({});
    expect(t.format("anthropic/claude-3-5-sonnet", EMPTY_CTX)).toBe("anthropic/claude-3-5-sonnet");
  });

  it("splits the provider/id only on the first slash", () => {
    // An id containing a slash (provider/id/extra) still resolves by the first two segments.
    captureCtx({
      modelRegistry: registryWith([{ id: "o3/mini", provider: "openai" }]) as unknown as ModelRegistry,
    });
    expect(t.format("openai/o3/mini", EMPTY_CTX)).toBe("o3/mini [openai]");
  });

  it("renders a value without a slash verbatim (no provider/id split)", () => {
    // A hand-edited or malformed value that lacks a '/' short-circuits the registry lookup and
    // renders verbatim rather than slicing into a bare id.
    captureCtx({ modelRegistry: registryWith([]) as unknown as ModelRegistry });
    expect(t.format("bare-value", EMPTY_CTX)).toBe("bare-value");
  });
});

describe("registerTypeDefinition — custom types", () => {
  it("a registered custom type is usable by a setting via getTypeDefinition (same path as built-ins)", () => {
    const customType: TypeDefinition<string> = {
      id: "test-host-port",
      valueType: "string",
      parse: (input) => (/^[a-z]+:\d+$/.test(input) ? input : undefined),
      format: (value) => value,
      supportsCustomValues: true,
      errorMessage: "Enter host:port",
    };
    registerTypeDefinition(customType);

    const resolved = getTypeDefinition("test-host-port");
    expect(resolved).toBe(customType);
    expect(resolved.parse("localhost:8080", EMPTY_CTX)).toBe("localhost:8080");
    expect(resolved.parse("garbage", EMPTY_CTX)).toBeUndefined();
    expect(resolved.errorMessage).toBe("Enter host:port");
    expect(resolved.valueType).toBe("string");
  });
});

describe("coerceTypedValue — serialize raw string → JS value for a type", () => {
  // Shared coercion used by schema-tabs (display) and value-picker (prefill). Number-typed
  // values are stored as numeric strings; coerce to a real number for format/toInputPrefill.
  // A non-numeric string (e.g. the null-label on a preset-less setting) falls back to the raw.
  it("coerces a numeric string to a number for a number valueType", () => {
    expect(coerceTypedValue("300000", getTypeDefinition("number"))).toBe(300000);
    expect(coerceTypedValue("7", getTypeDefinition("number"))).toBe(7);
  });

  it("coerces a numeric string to a number for a duration valueType", () => {
    expect(coerceTypedValue("60000", getTypeDefinition("duration"))).toBe(60000);
  });

  it("falls back to the raw string when not numeric (number valueType)", () => {
    expect(coerceTypedValue("Infinite", getTypeDefinition("number"))).toBe("Infinite");
    expect(coerceTypedValue("abc", getTypeDefinition("number"))).toBe("abc");
  });

  it("returns the raw string unchanged for string/boolean/compact-threshold valueTypes", () => {
    expect(coerceTypedValue("general", getTypeDefinition("string"))).toBe("general");
    expect(coerceTypedValue("compact>75K", getTypeDefinition("compact-threshold"))).toBe("compact>75K");
    expect(coerceTypedValue("true", getTypeDefinition("boolean"))).toBe("true");
  });
});

describe("formatRawForDisplay — runs format() on the display path", () => {
  // The guard fires format() only when the coerced value's type matches the type-def's valueType.
  // A string type whose format transforms the value proves format() runs (rather than the old
  // behavior of returning string-typed values verbatim).
  it("runs a string type's format on a string raw value", () => {
    const upper: TypeDefinition<string> = {
      id: "test-uppercase",
      valueType: "string",
      parse: (v) => v,
      format: (v) => v.toUpperCase(),
      supportsCustomValues: true,
      errorMessage: "n/a",
    };
    registerTypeDefinition(upper);
    expect(formatRawForDisplay("general", getTypeDefinition("test-uppercase"), EMPTY_CTX)).toBe("GENERAL");
  });

  it("runs the number type's format on a numeric raw value", () => {
    expect(formatRawForDisplay("300000", getTypeDefinition("duration"), EMPTY_CTX)).toBe("5m");
  });

  it("returns a non-numeric raw verbatim for a number type (NaN guard)", () => {
    // A null-label string like 'Infinite' must not be fed through duration.format (which would
    // render garbage) — returned as-is.
    expect(formatRawForDisplay("Infinite", getTypeDefinition("duration"), EMPTY_CTX)).toBe("Infinite");
  });

  it("returns a boolean raw verbatim (its 'true'/'false' raw already equals its format output)", () => {
    // Boolean is the one valueType whose raw is NOT run through format — its raw 'true'/'false'
    // already matches format(true)/format(false), and feeding the string through format would pass
    // a string where a boolean is expected. Guards against the widening regressing the boolean path.
    expect(formatRawForDisplay("true", getTypeDefinition("boolean"), EMPTY_CTX)).toBe("true");
    expect(formatRawForDisplay("false", getTypeDefinition("boolean"), EMPTY_CTX)).toBe("false");
  });

  it("runs the model type's format end-to-end (provider/id → display label)", () => {
    // The widening's motivating case: a model raw value flows through formatRawForDisplay, runs
    // the model type's format (provider/id → label via the captured registry), and renders the
    // display label — not the raw provider/id. (The uppercase probe proves the mechanism; this
    // proves it for the actual model type that needs it.)
    captureCtx({
      modelRegistry: {
        find: (provider: string, id: string) =>
          provider === "anthropic" && id === "claude-3-5-sonnet"
            ? { id: "claude-3-5-sonnet", provider: "anthropic" }
            : undefined,
        getAvailable: () => [],
        getError: () => undefined,
        refresh: () => {},
      } as unknown as ModelRegistry,
    });
    try {
      expect(formatRawForDisplay("anthropic/claude-3-5-sonnet", getTypeDefinition("model"), EMPTY_CTX)).toBe(
        "claude-3-5-sonnet [anthropic]",
      );
    } finally {
      captureCtx({});
    }
  });
});
