// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Custom-value validation for the settings value-picker.
 *
 * These functions sit ABOVE the `TypeDefinition` registry (they look a type up and run its
 * parse/format), so they live in their own module to keep the dependency graph acyclic:
 * `custom-validation → type-definitions → validation` (primitives). The parse/format PRIMITIVES
 * (`parseHumanDuration`, `formatHumanDuration`, …) stay in `validation.ts`.
 */

import type { SettingType } from "./schema.js";
import { getTypeDefinition, type TypeContext } from "./type-definitions.js";

/** Validate a custom value for a given setting type via the TypeDefinition registry.
 *  parse(input, ctx) → undefined? invalid; non-finite? invalid; bounded && out-of-[min,max]?
 *  invalid; else format(parsed). Returns the formatted internal value string, or undefined for invalid
 *  (undefined, never null). `ctx` (presets/min/max) is required — pass `null` to skip
 *  preset-matching and bounds (the value-picker always builds a real ctx from its presets). */
export function validateCustomValue(
  value: string,
  settingType: SettingType,
  ctx: TypeContext | null,
): string | undefined {
  const typeDef = getTypeDefinition(settingType);
  const parsed = typeDef.parse(value.trim(), ctx ?? { presets: [] });
  if (parsed === undefined) return undefined;
  // Finite check: reject Infinity/NaN so the resolver's accept-criteria stays a subset
  // of the gate's (the gate rejects non-finite via !Number.isFinite). The duration parser's bare-ms
  // fallback would otherwise let "Infinity" through (Number("Infinity")=Infinity).
  if (typeDef.valueType === "number" && typeof parsed === "number" && !Number.isFinite(parsed)) {
    return undefined;
  }
  if (typeDef.bounded === true && typeof parsed === "number" && ctx !== null) {
    if (ctx.min !== undefined && parsed < ctx.min) return undefined;
    if (ctx.max !== undefined && parsed > ctx.max) return undefined;
  }
  return typeDef.format(parsed, ctx ?? { presets: [] });
}

/** Setting types that accept genuinely meaningful free-form custom input (a TypeDefinition field lookup). */
export function supportsCustomValues(settingType: SettingType): boolean {
  return getTypeDefinition(settingType).supportsCustomValues;
}
