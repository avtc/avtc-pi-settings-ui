// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { describe, expect, it } from "vitest";
import { formatHumanDuration, parseHumanDuration } from "../src/validation.js";

describe("parseHumanDuration", () => {
  it("parses seconds", () => {
    expect(parseHumanDuration("30s")).toBe(30_000);
    expect(parseHumanDuration("90s")).toBe(90_000);
  });

  it("parses minutes", () => {
    expect(parseHumanDuration("5m")).toBe(300_000);
    expect(parseHumanDuration("1m")).toBe(60_000);
  });

  it("parses hours", () => {
    expect(parseHumanDuration("2h")).toBe(7_200_000);
    expect(parseHumanDuration("1h")).toBe(3_600_000);
  });

  it("parses days", () => {
    expect(parseHumanDuration("1d")).toBe(86_400_000);
    expect(parseHumanDuration("7d")).toBe(604_800_000);
    expect(parseHumanDuration("30d")).toBe(2_592_000_000);
    expect(parseHumanDuration("0.5d")).toBe(43_200_000);
  });

  it("parses milliseconds", () => {
    expect(parseHumanDuration("500ms")).toBe(500);
    expect(parseHumanDuration("1000ms")).toBe(1000);
  });

  it("parses fractional durations", () => {
    expect(parseHumanDuration("1.5m")).toBe(90_000);
    expect(parseHumanDuration("0.5h")).toBe(1_800_000);
  });

  // : parsers return undefined (not null) for invalid input. "Infinite" is no longer a
  // special parse case — null is owned by the gate's null-label step (the preset pair), so the
  // parser treats "Infinite" as ordinary invalid input.
  it("returns undefined (not null) for invalid input", () => {
    expect(parseHumanDuration("invalid")).toBeUndefined();
    expect(parseHumanDuration("")).toBeUndefined();
    expect(parseHumanDuration("Infinite")).toBeUndefined();
  });

  it("returns undefined for negative durations", () => {
    expect(parseHumanDuration("-5s")).toBeUndefined();
    expect(parseHumanDuration("-1m")).toBeUndefined();
  });

  it("parses zero as 0 (range rejection is the gate's job via min)", () => {
    expect(parseHumanDuration("0s")).toBe(0);
    expect(parseHumanDuration("0m")).toBe(0);
    expect(parseHumanDuration("0ms")).toBe(0);
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseHumanDuration("  5m  ")).toBe(300_000);
    expect(parseHumanDuration(" 90s")).toBe(90_000);
    expect(parseHumanDuration("2h ")).toBe(7_200_000);
  });
});

describe("formatHumanDuration", () => {
  it("formats null as Infinite", () => {
    expect(formatHumanDuration(null)).toBe("Infinite");
  });

  it("formats hours", () => {
    expect(formatHumanDuration(3_600_000)).toBe("1h");
    expect(formatHumanDuration(7_200_000)).toBe("2h");
  });

  it("formats minutes when >= 1 minute", () => {
    expect(formatHumanDuration(60_000)).toBe("1m");
    expect(formatHumanDuration(300_000)).toBe("5m");
  });

  it("formats fractional minutes", () => {
    expect(formatHumanDuration(90_000)).toBe("1.5m");
  });

  it("formats seconds when < 1 minute", () => {
    expect(formatHumanDuration(30_000)).toBe("30s");
    expect(formatHumanDuration(45_000)).toBe("45s");
  });

  it("formats milliseconds when < 1 second", () => {
    expect(formatHumanDuration(500)).toBe("500ms");
  });

  it("formats days when >= 1 day", () => {
    expect(formatHumanDuration(86_400_000)).toBe("1d");
    expect(formatHumanDuration(604_800_000)).toBe("7d");
    expect(formatHumanDuration(2_592_000_000)).toBe("30d");
  });

  it("round-trips with parseHumanDuration", () => {
    const values = [
      500,
      30_000,
      45_000,
      60_000,
      90_000,
      300_000,
      3_600_000,
      7_200_000,
      5_400_000,
      1_800_000,
      86_400_000,
      604_800_000,
      // Non-integer days (>= 1 day) take the fallthrough path -> format as hours, still round-trip.
      129_600_000, // 1.5d -> "36h"
    ];
    for (const ms of values) {
      expect(parseHumanDuration(formatHumanDuration(ms))).toBe(ms);
    }
  });

  it("handles edge values without floating-point issues", () => {
    expect(formatHumanDuration(59_999)).toBe("59s");
    expect(formatHumanDuration(59_500)).toBe("59s");
    expect(formatHumanDuration(90_001)).toBe("90s");
    expect(formatHumanDuration(5_400_000)).toBe("90m");
    expect(formatHumanDuration(1_800_000)).toBe("30m");
    expect(formatHumanDuration(90_000)).toBe("1.5m");
  });

  it("formats non-integer days as hours (fallthrough path)", () => {
    // 1.5d is >= 1 day but not a whole number of days, so it falls through the days tier to hours.
    expect(formatHumanDuration(129_600_000)).toBe("36h");
  });

  it("formats boundary value 1ms", () => {
    expect(formatHumanDuration(1)).toBe("1ms");
  });

  it("formats boundary value 999ms", () => {
    expect(formatHumanDuration(999)).toBe("999ms");
  });

  it("formats boundary value 1000ms (1s)", () => {
    expect(formatHumanDuration(1000)).toBe("1s");
  });

  it("formats boundary value 86_400_000ms (1d)", () => {
    expect(formatHumanDuration(86_400_000)).toBe("1d");
  });
});

describe("parseHumanDuration additional edge cases", () => {
  it("parses fractional seconds", () => {
    expect(parseHumanDuration("0.5s")).toBe(500);
  });

  it("parses fractional milliseconds", () => {
    expect(parseHumanDuration("1.5ms")).toBe(1.5);
  });
});
