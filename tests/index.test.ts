// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Public-surface contract test.
 *
 * Locks the exact set of symbols re-exported from the package entry (`index.ts`) so the
 * redesigned minimal surface does not regress: public values/types stay importable, and
 * internal symbols (the factory, the modal, persistence/normalization helpers, handle
 * lifecycle methods) do not leak back through the entry.
 *
 * Functional tests import internals from their `../src/...` paths; THIS is the only test
 * that imports through the public index — that is its sole purpose.
 */

import { describe, expect, it } from "vitest";
// Type-only imports — referenced in the compile-time surface assertion below. If any is
// removed from the public entry, this import fails to typecheck.
import type {
  PresetElement,
  PresetPair,
  PresetsSource,
  PresetValue,
  RegisterSettingsOptions,
  SettingSchema,
  SettingsHandle,
  SettingsSchema,
  SettingsTabSchema,
  StorageLevel,
  TypeContext,
  TypeDefinition,
} from "../index.js";
import * as Public from "../index.js";

describe("public surface", () => {
  it("exports the public value symbols", () => {
    expect(typeof Public.settingsFilePaths).toBe("function");
    expect(typeof Public.registerTypeDefinition).toBe("function");
    expect(typeof Public.registerSettingsCommand).toBe("function");
    expect(typeof Public.formatHumanDuration).toBe("function");
  });

  it("does not export internal symbols through the entry", () => {
    // Factory + modal + persistence/normalization helpers + handle lifecycle stay internal.
    const internals = [
      "createSettingsExtension",
      "openSettingsModal",
      "loadSettingsIntoMemory",
      "saveGlobalSettings",
      "saveProjectSettings",
      "computeDefaults",
      "loadSettingsFromFiles",
      "normalizeFromSchema",
      "clampSettings",
      "atomicWriteJson",
      "readJsonFile",
    ] as const;
    for (const name of internals) {
      expect(Public).not.toHaveProperty(name);
    }
  });

  it("exports the public type symbols (compile-time)", () => {
    // Each public type must be importable from the entry. If one is removed, the union
    // below fails to typecheck. The empty array is assignable to an array of the union.
    const surface: Array<
      | PresetElement
      | PresetPair
      | PresetsSource
      | PresetValue
      | RegisterSettingsOptions
      | SettingSchema
      | SettingsHandle
      | SettingsSchema
      | SettingsTabSchema
      | StorageLevel
      | TypeContext
      | TypeDefinition
    > = [];
    expect(Array.isArray(surface)).toBe(true);
  });
});
