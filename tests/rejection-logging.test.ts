// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { describe, expect, it, vi } from "vitest";

// Mock avtc-pi-logger so rejection logging can be asserted without file I/O or module-scoped
// logger state leaking across tests. The lazy logger() in normalization.ts calls createLogger, so
// a mock here captures every warn() emitted by logRejection. vi.hoisted shares the spy between
// the (hoisted) mock factory and the tests.
const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock("avtc-pi-logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: warnMock,
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }),
}));

import { normalizeFromSchema } from "../src/normalization.js";
import type { SettingsSchema } from "../src/schema.js";

/** A minimal schema with one enum and one bounded number, to drive rejections. */
const rejectionSchema: SettingsSchema = {
  settings: [
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
    {
      id: "count",
      label: "Count",
      type: "number",
      min: 1,
      defaultValue: 3,
    },
  ],
  tabs: [{ label: "Test", settingIds: ["mode", "count"] }],
  globalPath: () => "/tmp/test-global.json",
  projectPath: () => "/tmp/test-project.json",
};

describe("rejection logging (INVALID → default)", () => {
  it("emits a warn with the setting id, rejected value, and valid-options hint for an enum", () => {
    warnMock.mockClear();
    const result = normalizeFromSchema({ mode: "bogus" }, rejectionSchema);
    expect(result.mode).toBe("off"); // reset to default
    expect(warnMock).toHaveBeenCalledTimes(1);
    const msg = String(warnMock.mock.calls[0]?.[0]);
    expect(msg).toContain("mode"); // setting id
    expect(msg).toContain("bogus"); // rejected value
    expect(msg).toContain("valid: off, on"); // enum hint
    expect(msg).toContain("reset to default");
  });

  it("emits a warn with the [min,max] hint for an out-of-bounds number", () => {
    warnMock.mockClear();
    const result = normalizeFromSchema({ count: -5 }, rejectionSchema);
    expect(result.count).toBe(3); // reset to default
    expect(warnMock).toHaveBeenCalledTimes(1);
    const msg = String(warnMock.mock.calls[0]?.[0]);
    expect(msg).toContain("count");
    expect(msg).toContain("-5");
    expect(msg).toContain("valid: 1-inf"); // bounded hint, ASCII
  });

  it("does NOT warn for a valid value", () => {
    warnMock.mockClear();
    normalizeFromSchema({ mode: "on", count: 7 }, rejectionSchema);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("does NOT warn for an ABSENT value (absent = default-fill, not a rejection)", () => {
    warnMock.mockClear();
    // Only count is present; mode is absent → fills default silently (no warn spam on every load).
    normalizeFromSchema({ count: 7 }, rejectionSchema);
    expect(warnMock).not.toHaveBeenCalled();
  });
});
