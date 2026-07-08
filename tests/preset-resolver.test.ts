// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Tests for resolveFunctionPresets — the UI-time batch resolution of function-presets
 * (resolved once at modal-open so the live model list is current). A resolver function may
 * be synchronous or async, may throw, and is invoked with no arguments.
 */

import { describe, expect, it } from "vitest";
import { resolveFunctionPresets } from "../src/preset-resolver.js";
import type { PresetPair, SettingSchema, SettingsSchema } from "../src/schema.js";

/** A setting whose `presets` is a sync function. */
function resolverSetting(id: string, fn: () => PresetPair[] | Promise<PresetPair[]>): SettingSchema {
  return { id, label: id, type: "string", defaultValue: "a", presets: fn };
}

function schemaOf(settings: SettingSchema[]): SettingsSchema {
  return {
    settings,
    tabs: [{ label: "T", settingIds: settings.map((s) => s.id) }],
    globalPath: () => "/tmp/test.json",
    projectPath: () => "/tmp/test.json",
  };
}

describe("resolveFunctionPresets", () => {
  it("resolves a synchronous resolver into a map keyed by setting id", async () => {
    const pairs: PresetPair[] = [
      ["Default", null],
      ["a", "a"],
    ];
    const schema = schemaOf([resolverSetting("sid", () => pairs)]);

    const { pairs: map } = await resolveFunctionPresets(schema);

    expect(map.get("sid")).toEqual(pairs);
  });

  it("resolves an async resolver (returns a Promise)", async () => {
    const pairs: PresetPair[] = [
      ["Default", null],
      ["async", "async"],
    ];
    const schema = schemaOf([resolverSetting("asyncSid", () => Promise.resolve(pairs))]);

    const { pairs: map } = await resolveFunctionPresets(schema);

    expect(map.get("asyncSid")).toEqual(pairs);
  });

  it("degrades a throwing (synchronous) resolver to an empty pairs list", async () => {
    const schema = schemaOf([
      resolverSetting("boom", () => {
        throw new Error("boom");
      }),
    ]);

    const { pairs: map } = await resolveFunctionPresets(schema);

    expect(map.get("boom")).toEqual([]);
  });

  it("degrades an async-rejecting resolver to an empty pairs list", async () => {
    const schema = schemaOf([resolverSetting("rejectSid", () => Promise.reject(new Error("reject")))]);

    const { pairs: map } = await resolveFunctionPresets(schema);

    expect(map.get("rejectSid")).toEqual([]);
  });

  it("one throwing resolver does not fail the batch (others still resolve)", async () => {
    const good: PresetPair[] = [
      ["Default", null],
      ["ok", "ok"],
    ];
    const schema = schemaOf([
      resolverSetting("good", () => good),
      resolverSetting("bad", () => {
        throw new Error("bad");
      }),
    ]);

    const { pairs: map } = await resolveFunctionPresets(schema);

    expect(map.get("good")).toEqual(good);
    expect(map.get("bad")).toEqual([]);
  });

  it("records failing setting ids in failedIds so the caller can warn the user", async () => {
    // A resolver failure must not be silent: the failing ids are surfaced so the caller can
    // notify the user (TUI hides console.* output, so failures travel back as data, not logs).
    const schema = schemaOf([
      resolverSetting("ok", () => [["a", "a"]]),
      resolverSetting("boom", () => {
        throw new Error("boom");
      }),
      resolverSetting("reject", () => Promise.reject(new Error("reject"))),
    ]);

    const { failedIds } = await resolveFunctionPresets(schema);

    // Order is not guaranteed (microtask scheduling): assert as a set, not a sequence.
    expect(failedIds).toEqual(expect.arrayContaining(["boom", "reject"]));
    expect(failedIds.length).toBe(2);
  });

  it("failedIds is empty when every resolver succeeds", async () => {
    const schema = schemaOf([resolverSetting("ok", () => [["a", "a"]])]);

    const { failedIds } = await resolveFunctionPresets(schema);

    expect(failedIds).toEqual([]);
  });

  it("ignores static-array presets (only function sources are resolved)", async () => {
    const schema = schemaOf([
      { id: "static", label: "Static", type: "string", defaultValue: "a", presets: [["a", "a"]] },
    ]);

    const { pairs: map, failedIds } = await resolveFunctionPresets(schema);

    // No function presets → empty map (static presets are resolved elsewhere, via the WeakMap cache).
    expect(map.size).toBe(0);
    expect(failedIds).toEqual([]);
  });
});
