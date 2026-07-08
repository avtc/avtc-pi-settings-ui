// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Schema-driven settings normalization.
 *
 * Replaces per-field switch-based validation with a single loop over the schema.
 */

import { createLogger, type Logger } from "avtc-pi-logger";
import type {
  PresetElement,
  PresetItem,
  PresetPair,
  PresetsSource,
  PresetValue,
  SettingSchema,
  SettingsSchema,
} from "./schema.js";
import type { TypeContext } from "./type-definitions.js";
import { getTypeDefinition } from "./type-definitions.js";

/**
 * Module-private sentinel for an invalid result from the core resolver.
 * The load wrapper maps INVALID → default; the update wrapper maps INVALID → no update.
 */
const INVALID = Symbol("invalid");

/**
 * Best-effort logger for rejected settings values. Created lazily so importing this module does
 * no file work; the first rejection (load or update) initializes the writer. The logger never
 * throws — a logging failure cannot break settings load.
 */
const NO_LOGGER_OPTIONS: Parameters<typeof createLogger>[1] = null;
let _logger: Logger | null = null;
function logger(): Logger {
  if (_logger === null) _logger = createLogger("avtc-pi-settings-ui", NO_LOGGER_OPTIONS);
  return _logger;
}

/**
 * Resolve value aliases for a setting. If the raw value matches a valueAlias key,
 * returns the mapped raw value; otherwise returns the raw value unchanged.
 */
export function resolveValueAlias(rawValue: unknown, setting: SettingSchema): unknown {
  if (typeof rawValue === "string" && setting.valueAliases && rawValue in setting.valueAliases) {
    const alias = setting.valueAliases[rawValue];
    if (alias !== undefined) return alias;
  }
  return rawValue;
}

/**
 * Build the `TypeContext` for a setting — presets (as PresetPair[]) + min/max. A custom type's
 * parse/format derives the null label itself from ctx.presets (the pair whose value is null).
 */
function buildTypeContext(setting: SettingSchema): TypeContext {
  return { presets: resolveStaticPresets(setting), min: setting.min, max: setting.max };
}

/**
 * The core single-setting resolver — the ONE gate used by load (`resolveValue`), update
 * (`updateSetting`), and env-var deserialize (which calls `normalizeFromSchema`).
 * Returns the resolved value, or the `INVALID` sentinel when the raw value is rejected.
 *
 * 8-step gate:
 *  1. aliases 2. valueAliases 3. null-label string → null
 4. null validity (null-preset — nullLabel defined)
 5. parse-if-string (typeDef.parse — the type→parser registry)
 6. type-match (`typeof === valueType`) 7. finite (number/duration) 8. `[min,max]` bounds
*/
export function resolveSettingValue(raw: Record<string, unknown>, setting: SettingSchema): unknown {
  // 1. field aliases (old keys → this setting's id)
  let value = raw[setting.id];
  if (value === undefined && setting.aliases) {
    for (const alias of setting.aliases) {
      if (raw[alias] !== undefined) {
        value = raw[alias];
        break;
      }
    }
  }

  // 2. value aliases (old value renames) — only for string values
  if (typeof value === "string") {
    value = resolveValueAlias(value, setting);
  }

  // 3. null-label string → null (e.g. stored/typed "Infinite"/"Never"/"ask" → null).
  const nullLabel = resolveNullLabel(setting);
  if (typeof value === "string" && nullLabel !== undefined && value === nullLabel) {
    value = null;
  }

  const typeDef = getTypeDefinition(setting.type);

  // 4. null validity — keep null iff a null-preset exists (nullLabel derived from the effective
  //    presets). A type with no null-preset rejects null. Legitimate nulls never reach parse.
  if (value === null) {
    return nullLabel !== undefined ? null : INVALID;
  }

  // 5. parse-if-string. Parse is string-only by signature; raw numbers/booleans
  //    never enter it.
  if (typeof value === "string") {
    const p = typeDef.parse(value, buildTypeContext(setting));
    if (p === undefined) return INVALID;
    value = p;
  }

  // 6. type-match — typeof must equal the type's declared valueType.
  if (typeof value !== typeDef.valueType) return INVALID;

  // 7. finite check (number/duration) — Infinity/NaN must not pass the bounds range test.
  if (typeDef.valueType === "number" && !Number.isFinite(value as number)) return INVALID;

  // 8. bounds — only for bounded types with a declared min/max.
  if (typeDef.bounded === true) {
    if (setting.min !== undefined && (value as number) < setting.min) return INVALID;
    if (setting.max !== undefined && (value as number) > setting.max) return INVALID;
  }

  return value;
}

/**
 * Resolve a value from raw data for a single setting (LOAD disposition).
 * Thin wrapper over the core resolver: INVALID → default. Logs the rejection only when a value
 * was actually PRESENT (an absent key is the normal default-fill path — not a rejection).
 */
function resolveValue(raw: Record<string, unknown>, setting: SettingSchema): unknown {
  const result = resolveSettingValue(raw, setting);
  if (result === INVALID) {
    if (isSettingPresent(raw, setting)) logRejection(raw, setting);
    return setting.defaultValue;
  }
  return result;
}

/** True when the raw record carries a value for this setting (by id or any alias). */
function isSettingPresent(raw: Record<string, unknown>, setting: SettingSchema): boolean {
  if (raw[setting.id] !== undefined) return true;
  return setting.aliases?.some((alias) => raw[alias] !== undefined) ?? false;
}

/**
 * Emit a best-effort warn log when a setting value is rejected at load. Includes the valid
 * options when available — preset values for an enum, or the [min,max] bounds for a bounded
 * number/duration — so a silent reset-to-default is diagnosable. Never throws.
 */
function logRejection(raw: Record<string, unknown>, setting: SettingSchema): void {
  try {
    const rawValue = raw[setting.id];
    const valid = validOptionsHint(setting);
    const suffix = valid !== null ? ` (valid: ${valid})` : "";
    // The raw value is interpolated verbatim — avtc-pi-logger sanitizes control chars (line
    // forging) and truncates (runaway length) at the emit boundary, so this stays single-line.
    logger().warn(`Setting '${setting.id}' rejected value '${String(rawValue)}'${suffix} - reset to default`);
  } catch {
    // logging is best-effort; never break a load on a logging failure
  }
}

/**
 * A human-readable hint of the acceptable values for a setting, or null when no hint applies
 * (e.g. a free-form string). Enum → comma-joined preset values; bounded number/duration → the
 * [min,max] range (ASCII). Resolver-function presets (model list) yield no static values → null.
 */
function validOptionsHint(setting: SettingSchema): string | null {
  const pairs = resolveStaticPresets(setting);
  if (pairs.length > 0) {
    return pairs.map(([, value]) => String(value)).join(", ");
  }
  const typeDef = getTypeDefinition(setting.type);
  if (typeDef.bounded === true && (setting.min !== undefined || setting.max !== undefined)) {
    const lower = setting.min !== undefined ? String(setting.min) : "-inf";
    const upper = setting.max !== undefined ? String(setting.max) : "inf";
    return `${lower}-${upper}`;
  }
  return null;
}

/**
 * Test whether a `resolveSettingValue` result is the INVALID sentinel. The sentinel itself is
 * module-private; this predicate is the public seam so `updateSetting` (factory.ts) can apply the
 * update disposition (INVALID → no-update) without re-implementing the gate. (one gate)
 */
export function isInvalidResult(value: unknown): boolean {
  return value === INVALID;
}

/**
 * Normalize raw settings using schema definitions.
 * Iterates schema entries, checks aliases, applies parsers, fills defaults.
 * Replaces N-field switch statements with a single data-driven loop.
 */
export function normalizeFromSchema(raw: Record<string, unknown>, schema: SettingsSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const setting of schema.settings) {
    result[setting.id] = resolveValue(raw, setting);
  }

  return result;
}

/**
 * Validate a schema's structural integrity at registration (`createSettingsExtension` — fail-fast
 * so a consumer's malformed schema surfaces immediately, not as a mysterious runtime gap). Checks:
 * (a) preset strings — every static-preset setting's bare strings parse
 *     (`normalizePresetElements` throws on an unparseable one), eagerly populating the cache so a
 *     runtime resolution never re-throws;
 * (b) orphans — every setting id appears in some tab;
 * (c) unresolved ids — every `tab.settingId` references a defined setting.
 * Duplicate setting ids are also rejected (ambiguous lookup). Throws on the first violation.
 */
export function validateSchema(schema: SettingsSchema): void {
  // (a) preset strings (also eagerly populates the static-presets cache)
  for (const setting of schema.settings) {
    resolveStaticPresets(setting);
  }

  const settingIds = new Set<string>();
  for (const setting of schema.settings) {
    if (settingIds.has(setting.id)) {
      throw new Error(`Schema: duplicate setting id '${setting.id}'`);
    }
    settingIds.add(setting.id);
  }

  // (b) every setting placed in some tab
  const referenced = new Set<string>();
  for (const tab of schema.tabs) {
    for (const id of tab.settingIds) referenced.add(id);
  }
  for (const id of settingIds) {
    if (!referenced.has(id)) {
      throw new Error(`Schema: setting '${id}' is not placed in any tab`);
    }
  }

  // (c) every tab.settingId references a defined setting
  for (const tab of schema.tabs) {
    for (const id of tab.settingIds) {
      if (!settingIds.has(id)) {
        throw new Error(`Schema: tab '${tab.label}' references unknown setting '${id}'`);
      }
    }
  }
}

/**
 * Apply post-normalization clamps for settings with inter-field constraints
 * that cannot be expressed per-field in the schema.
 */
export function clampSettings(
  result: Record<string, unknown>,
  clampFn: ((result: Record<string, unknown>) => void) | undefined,
): void {
  clampFn?.(result);
}

/**
 * Get the effective value for a setting from raw data.
 * Returns the default if the raw value is invalid.
 */
export function getEffectiveValue(raw: Record<string, unknown>, setting: SettingSchema): unknown {
  return resolveValue(raw, setting);
}

/**
 * Compute the raw internal string value for a setting.
 * Converts null to the appropriate sentinel string.
 */
export function computeRawInternalValue(settings: Record<string, unknown>, setting: SettingSchema): string {
  const value = settings[setting.id];
  if (value === null || value === undefined) {
    // Display fallback only — the null label for nullable settings, or "Infinite" defensively
    // for non-nullable settings that shouldn't hold null anyway.
    return resolveNullLabel(setting) ?? "Infinite";
  }
  return String(value);
}

// ── Preset resolvers (single source: `presets` pairs, resolved via the effective seam) ──

/**
 * Per-setting cache of normalized static presets. `SettingSchema` refs are stable, so a WeakMap
 * lets the gate resolve a setting's pairs once instead of re-normalizing (re-parsing bare
 * strings) on every load. Populated eagerly by `createSettingsExtension` schema validation.
 */
const staticPresetsCache = new WeakMap<SettingSchema, PresetPair[]>();

/** Type guard: a `PresetElement` is a pair when it is an array (a bare value is never array-typed). */
function isPresetPair(el: PresetElement): el is PresetPair {
  return Array.isArray(el);
}

/**
 * Normalize a `PresetElement[]` (bare values OR full pairs, possibly MIXED) into `PresetPair[]`
 * at the single resolution seam. Bare string → type-aware `[s, typeDef.parse(s, ctx)]` (duration
 * "30m"→1800000ms, string→identity via an empty-presets ctx, custom types free); bare
 * number/boolean/null → `[String(v), v]`; a full `PresetPair` → as-is. An unparseable bare string
 * THROWS — caught at registration (createSettingsExtension schema validation → fail-fast) or by a
 * resolver's degrade-to-empty for async sources. Downstream stays `PresetPair[]`-based.
 */
export function normalizePresetElements(elements: readonly PresetElement[], setting: SettingSchema): PresetPair[] {
  const typeDef = getTypeDefinition(setting.type);
  // Empty-presets ctx so the string type's closed-enum parse degrades to identity (a bare enum
  // value like "high" becomes ["high","high"], not a membership-rejection). number/duration parses
  // ignore presets; compact-threshold falls back to its numeric path.
  const ctx: TypeContext = { presets: [], min: setting.min, max: setting.max };
  const result: PresetPair[] = [];
  for (const el of elements) {
    if (isPresetPair(el)) {
      result.push(el);
      continue;
    }
    if (typeof el === "string") {
      const parsed = typeDef.parse(el, ctx);
      if (parsed === undefined) {
        throw new Error(`Setting '${setting.id}': preset '${el}' is not a valid ${setting.type}`);
      }
      result.push([el, parsed as PresetValue]);
    } else {
      // number | boolean | null → [String(v), v]
      result.push([String(el), el]);
    }
  }
  return result;
}

/**
 * Resolve the EFFECTIVE source of presets for a setting: `setting.presets ?? typeDef.presets`.
 * This is the single source of truth for the override pick — the gate and the UI both go through
 * it. A resolver-function source is flagged `isFunction: true` with empty `pairs` (the gate
 * cannot call a resolver, so it treats it as no presets at load; the UI resolves it once at
 * modal-open). A static-array source yields the pairs directly. Absent at both levels → empty.
 */
export function resolveEffectivePresets(setting: SettingSchema): {
  isFunction: boolean;
  pairs: PresetPair[];
} {
  const src: PresetsSource | undefined = setting.presets ?? getTypeDefinition(setting.type).presets;
  if (src === undefined) return { isFunction: false, pairs: [] };
  if (typeof src === "function") return { isFunction: true, pairs: [] };
  // Static array — normalize PresetElement[] → PresetPair[] once (cached on the stable schema ref).
  // Validation at createSettingsExtension forces this normalization eagerly and throws on a bad
  // bare string, so a runtime call never re-throws (the cache is already populated).
  let cached = staticPresetsCache.get(setting);
  if (!cached) {
    cached = normalizePresetElements(src, setting);
    staticPresetsCache.set(setting, cached);
  }
  return { isFunction: false, pairs: [...cached] };
}

/**
 * Resolve the STATIC presets for a setting — the pairs the gate can use at load. Resolver-function
 * sources collapse to `[]` here (resolved later by the UI); static-array sources yield their
 * pairs. Thin wrapper over `resolveEffectivePresets` so call sites that only need the pairs keep
 * a stable shape.
 */
export function resolveStaticPresets(setting: SettingSchema): PresetPair[] {
  return resolveEffectivePresets(setting).pairs;
}

/**
 * The display label for the null value — the label of the preset pair whose value is null.
 * Returns `undefined` when the setting is NOT nullable (no null pair): callers use this to
 * decide whether null handling applies at all, so a non-nullable timeout correctly rejects
 * "Infinite". For a well-formed nullable setting, a null pair always exists, so the label
 * is fully derived from `presets`. Reads the EFFECTIVE static presets (setting override OR
 * type-def default); resolver-function sources correctly yield `undefined` at load (their null
 * label is resolved from pairs at UI time).
 */
export function resolveNullLabel(setting: SettingSchema): string | undefined {
  return resolveNullLabelFromPairs(resolveStaticPresets(setting));
}

/** Serialize a preset value (string | number | boolean | null) to its internal string form. */
function serializePresetValue(value: string | number | boolean | null, nullLabel: string): string {
  return value === null ? nullLabel : String(value);
}

/**
 * The display label for the null value, derived directly from a pairs array. Pure pair-level
 * helper shared by `resolveNullLabel` (via `resolveStaticPresets`) and the UI's resolved-pairs
 * path (a resolver's `[["Default", null], …]` is only available after resolution at open).
 * Returns `undefined` when no pair has a null value.
 */
export function resolveNullLabelFromPairs(pairs: readonly PresetPair[]): string | undefined {
  for (const [label, value] of pairs) {
    if (value === null) return label;
  }
  return undefined;
}

/**
 * Build the full `PresetItem[]` (label + rawValue + displayValue) from a pairs array, in display
 * order. Pure pair-level derivation shared by the gate (via `buildPresetItems(setting)`) and the
 * UI's resolved-pairs path. The displayValue is the serialized string form (the null pair
 * serializes to its label, or "Infinite" defensively when no null pair exists).
 */
export function buildPresetItemsFromPairs(pairs: readonly PresetPair[]): readonly PresetItem[] {
  const nullLabel = resolveNullLabelFromPairs(pairs) ?? "Infinite";
  return pairs.map(([label, value]) => ({
    label,
    rawValue: value,
    displayValue: serializePresetValue(value, nullLabel),
  }));
}

/**
 * Build the full `PresetItem[]` for a setting from its EFFECTIVE static presets. Thin wrapper
 * over `buildPresetItemsFromPairs(resolveStaticPresets(setting))` — kept for its existing tested
 * signature. Resolver-function sources yield `[]` here (resolved by the UI at open).
 */
export function buildPresetItems(setting: SettingSchema): readonly PresetItem[] {
  return buildPresetItemsFromPairs(resolveStaticPresets(setting));
}
