// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { describe, expect, it } from "vitest";
import { supportsCustomValues, validateCustomValue } from "../src/custom-validation.js";
import { formatCompactThreshold, parseCompactThreshold } from "../src/validation.js";

describe("compact threshold helpers", () => {
  it("parseCompactThreshold converts number to compact>NK", () => {
    expect(parseCompactThreshold("300")).toBe("compact>300K");
    expect(parseCompactThreshold("75")).toBe("compact>75K");
  });

  // : parser returns undefined (not null) for invalid input.
  it("parseCompactThreshold rejects zero and negative (returns undefined)", () => {
    expect(parseCompactThreshold("0")).toBeUndefined();
    expect(parseCompactThreshold("-5")).toBeUndefined();
  });

  it("parseCompactThreshold rejects non-numeric (returns undefined)", () => {
    expect(parseCompactThreshold("abc")).toBeUndefined();
  });

  it("formatCompactThreshold extracts number from compact>NK", () => {
    expect(formatCompactThreshold("compact>75K")).toBe("75");
    expect(formatCompactThreshold("compact>300K")).toBe("300");
  });

  it("formatCompactThreshold returns empty for non-threshold values", () => {
    expect(formatCompactThreshold("none")).toBe("");
    expect(formatCompactThreshold("compact")).toBe("");
    expect(formatCompactThreshold("new-session")).toBe("");
  });
});

describe("validateCustomValue", () => {
  it("validates number type", () => {
    expect(validateCustomValue("7", "number", null)).toBe("7");
    expect(validateCustomValue("0", "number", null)).toBe("0");
    // : number accepts ANY integer (floor comes from min/ctx, not the parser).
    expect(validateCustomValue("-1", "number", null)).toBe("-1");
    expect(validateCustomValue("abc", "number", null)).toBeUndefined();
  });

  it("validates duration type", () => {
    expect(validateCustomValue("5m", "duration", null)).toBe("5m");
    expect(validateCustomValue("90s", "duration", null)).toBe("1.5m");
    expect(validateCustomValue("Infinite", "duration", null)).toBeUndefined();
    expect(validateCustomValue("0s", "duration", null)).toBe("0ms");
  });

  it("validates compact-threshold type", () => {
    expect(validateCustomValue("300", "compact-threshold", null)).toBe("compact>300K");
    expect(validateCustomValue("0", "compact-threshold", null)).toBeUndefined();
    expect(validateCustomValue("-1", "compact-threshold", null)).toBeUndefined();
  });

  it("trims whitespace from input", () => {
    expect(validateCustomValue("  7  ", "number", null)).toBe("7");
    expect(validateCustomValue(" 5m ", "duration", null)).toBe("5m");
    expect(validateCustomValue(" 3d ", "duration", null)).toBe("3d");
    expect(validateCustomValue(" 300 ", "compact-threshold", null)).toBe("compact>300K");
    expect(validateCustomValue(" Infinite ", "duration", null)).toBeUndefined();
  });

  it("canonicalizes duration values", () => {
    expect(validateCustomValue("90s", "duration", null)).toBe("1.5m");
    expect(validateCustomValue("120s", "duration", null)).toBe("2m");
    expect(validateCustomValue("1h", "duration", null)).toBe("1h");
    expect(validateCustomValue("60000ms", "duration", null)).toBe("1m");
    expect(validateCustomValue("14d", "duration", null)).toBe("14d");
    // : the bare-ms Number(input) fallback accepts a raw ms count.
    expect(validateCustomValue("3600000", "duration", null)).toBe("1h");
    expect(validateCustomValue("604800000", "duration", null)).toBe("7d");
  });

  it("canonicalizes compact-threshold values", () => {
    expect(validateCustomValue("300", "compact-threshold", null)).toBe("compact>300K");
    expect(parseCompactThreshold("compact>300K")).toBeUndefined();
  });

  it("rejects empty and whitespace-only input", () => {
    expect(validateCustomValue("", "number", null)).toBeUndefined();
    expect(validateCustomValue("   ", "number", null)).toBeUndefined();
    expect(validateCustomValue("", "duration", null)).toBeUndefined();
    expect(validateCustomValue("", "compact-threshold", null)).toBeUndefined();
  });

  it("rejects trailing non-numeric characters", () => {
    // validateCustomValue must use strict integer check, not parseInt which silently truncates
    expect(validateCustomValue("7abc", "number", null)).toBeUndefined();
    // Also test leading zeros are handled correctly
    expect(validateCustomValue("007", "number", null)).toBe("7");
    expect(validateCustomValue(" 007 ", "number", null)).toBe("7");
  });

  // --- Boundary tests ---

  it("boundary: duration accepts small values", () => {
    expect(validateCustomValue("1ms", "duration", null)).toBe("1ms");
    expect(validateCustomValue("1s", "duration", null)).toBe("1s");
    expect(validateCustomValue("500ms", "duration", null)).toBe("500ms");
  });

  it("boundary: duration zero is valid; range rejection comes from min (not the parser)", () => {
    // No ctx (null) → no bounds → 0 is valid.
    expect(validateCustomValue("0ms", "duration", null)).toBe("0ms");
    expect(validateCustomValue("0s", "duration", null)).toBe("0ms");
    // min > 0 rejects 0 (the gate/bounds path, not the parser).
    expect(validateCustomValue("0s", "duration", { presets: [], min: 1 })).toBeUndefined();
    expect(validateCustomValue("0s", "duration", { presets: [], min: 0 })).toBe("0ms");
    // Negative is structurally invalid (the regex has no leading sign).
    expect(validateCustomValue("-5m", "duration", null)).toBeUndefined();
  });

  it("boundary: compact-threshold minimum valid is 1", () => {
    expect(validateCustomValue("1", "compact-threshold", null)).toBe("compact>1K");
    expect(validateCustomValue("0", "compact-threshold", null)).toBeUndefined();
    expect(validateCustomValue("-5", "compact-threshold", null)).toBeUndefined();
  });
});

describe("validateCustomValue — registry resolver", () => {
  // validateCustomValue now delegates to the TypeDefinition registry: parse → format, returning
  // undefined (not null) for invalid input. Schema-level bounds come from the optional ctx.
  it("returns undefined (not null) for invalid input", () => {
    expect(validateCustomValue("abc", "number", null)).toBeUndefined();
    expect(validateCustomValue("not-a-duration", "duration", null)).toBeUndefined();
  });

  it("rejects non-finite numeric input (Infinity/NaN) — matches the gate's finite check", () => {
    expect(validateCustomValue("Infinity", "duration", null)).toBeUndefined();
    expect(validateCustomValue("Infinity", "number", null)).toBeUndefined();
    expect(validateCustomValue("NaN", "number", null)).toBeUndefined();
  });

  it("rejects out-of-bounds values via ctx.min/ctx.max (bounded types)", () => {
    const ctx = { presets: [], min: 1, max: 10 };
    expect(validateCustomValue("0", "number", ctx)).toBeUndefined();
    expect(validateCustomValue("11", "number", ctx)).toBeUndefined();
    expect(validateCustomValue("5", "number", ctx)).toBe("5");
  });

  it("ignores bounds when ctx is null (value-picker path without min/max)", () => {
    expect(validateCustomValue("0", "number", null)).toBe("0");
  });
});

describe("supportsCustomValues", () => {
  it("returns true for numeric/duration/threshold types (free-form input is meaningful)", () => {
    expect(supportsCustomValues("number")).toBe(true);
    expect(supportsCustomValues("duration")).toBe(true);
    expect(supportsCustomValues("compact-threshold")).toBe(true);
  });

  it("returns false for string and boolean types (closed value sets)", () => {
    expect(supportsCustomValues("string")).toBe(false);
    expect(supportsCustomValues("boolean")).toBe(false);
  });
});
