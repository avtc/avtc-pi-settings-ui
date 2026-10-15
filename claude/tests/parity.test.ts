// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

// Parity pins: the ported pure modules must behave exactly like the terminal
// variant's sources on shared fixtures. The pi modules import their own deps
// from this repo's node_modules — legal here because tests never join a
// mod's hooks closure.

import { describe, expect, test } from "vitest";
import * as piNorm from "../../src/normalization.js";
import * as piTabs from "../../src/ui/schema-tabs.js";
import * as portNorm from "../src/normalization.js";
import type { SettingsSchema } from "../src/schema.js";
import * as portTabs from "../src/schema-tabs.js";

const SCHEMA: SettingsSchema = {
  tabs: [
    { label: "General", settingIds: ["enabled", "interval", "name"] },
    { label: "Models", settingIds: ["model", "level"] },
  ],
  settings: [
    { id: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
    { id: "interval", label: "Interval", type: "duration", defaultValue: 30000, min: 1000, max: 600000 },
    { id: "name", label: "Name", type: "string", defaultValue: "owl" },
    { id: "model", label: "Model", type: "model", defaultValue: null },
    {
      id: "level",
      label: "Level",
      type: "string",
      defaultValue: "medium",
      presets: [
        ["Low", "low"],
        ["Medium", "medium"],
        ["High", "high"],
      ],
    },
  ],
  globalPath: (globalDir?: string) => `/g/${globalDir ?? "home"}/x-settings.json`,
  projectPath: (cwd: string) => `${cwd}/.claude/x-settings.json`,
} as unknown as SettingsSchema;

const RAW_VALUES: Record<string, unknown>[] = [
  {},
  { enabled: "nope" },
  { enabled: false },
  { interval: "2m" },
  { interval: 999999999 },
  { interval: "not-a-duration" },
  { name: 42 },
  { model: "anthropic/claude-sonnet-4" },
  { level: "low" },
  { level: "unknown" },
  { unknownKey: 1 },
];

describe("normalization parity — port vs terminal source", () => {
  for (const [i, raw] of RAW_VALUES.entries()) {
    test(`raw fixture ${i}: ${JSON.stringify(raw)}`, () => {
      const fromPi = piNorm.normalizeFromSchema({ ...raw }, SCHEMA);
      const fromPort = portNorm.normalizeFromSchema({ ...raw }, SCHEMA);
      expect(fromPort).toEqual(fromPi);
    });
  }

  test("clamped fixture parity", () => {
    const raw = { interval: "10s", level: "high" };
    const clamp = (result: Record<string, unknown>) => {
      if (typeof result.interval === "number" && result.interval > 100000) {
        result.interval = 100000;
      }
    };
    const fromPi = piNorm.normalizeFromSchema({ ...raw }, SCHEMA);
    piNorm.clampSettings(fromPi, clamp);
    const fromPort = portNorm.normalizeFromSchema({ ...raw }, SCHEMA);
    portNorm.clampSettings(fromPort, clamp);
    expect(fromPort).toEqual(fromPi);
  });
});

describe("schema-tabs parity — the tab group builder", () => {
  test("identical TabDefinition[] for a settings snapshot", () => {
    const settings = { enabled: true, interval: 30000, name: "owl", model: null, level: "medium" };
    const piBuilt = piTabs.buildSchemaTabGroups(settings as Record<string, unknown>, SCHEMA as never, new Map());
    const portBuilt = portTabs.buildSchemaTabGroups(settings as Record<string, unknown>, SCHEMA, new Map());
    expect(portBuilt).toEqual(piBuilt);
  });

  test("identical groups with resolved preset pairs", () => {
    const settings = { enabled: false, interval: 60000, name: "x", model: "anthropic/claude-sonnet-4", level: "low" };
    const pairs = new Map<string, [string, string | null][]>([
      [
        "model",
        [
          ["Default", null],
          ["claude-sonnet-4 [anthropic]", "anthropic/claude-sonnet-4"],
        ],
      ],
    ]);
    const piBuilt = piTabs.buildSchemaTabGroups(settings as Record<string, unknown>, SCHEMA as never, pairs as never);
    const portBuilt = portTabs.buildSchemaTabGroups(settings as Record<string, unknown>, SCHEMA, pairs as never);
    expect(JSON.stringify(portBuilt)).toBe(JSON.stringify(piBuilt));
  });
});

describe("logger seam", () => {
  test("default no-op; injected sink receives rejection warnings", () => {
    const seen: string[] = [];
    portNorm.setSettingsLogger({ warn: (m) => seen.push(m) });
    try {
      const out = portNorm.normalizeFromSchema({ interval: "garbage" }, SCHEMA);
      expect(out.interval).toBe(30000);
      expect(seen.length).toBeGreaterThan(0);
    } finally {
      portNorm.setSettingsLogger(null);
    }
  });
});
