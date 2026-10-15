/**
 * Schema-driven settings normalization.
 *
 * Replaces per-field switch-based validation with a single loop over the schema.
 */
import type { PresetElement, PresetItem, PresetPair, SettingSchema, SettingsSchema } from "./schema.js";
/**
 * Best-effort logger for rejected settings values. Injected by the host at
 * wiring time (never imports a package here — this module lives inside a mod's
 * hooks closure); the default sink drops everything. A logging failure can
 * never break settings load.
 */
export interface SettingsLogger {
    warn: (message: string) => void;
}
/** Inject the sink rejected-values warnings go to (idempotent; call before first use). */
export declare function setSettingsLogger(logger: SettingsLogger | null): void;
/**
 * Resolve value aliases for a setting. If the raw value matches a valueAlias key,
 * returns the mapped raw value; otherwise returns the raw value unchanged.
 */
export declare function resolveValueAlias(rawValue: unknown, setting: SettingSchema): unknown;
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
export declare function resolveSettingValue(raw: Record<string, unknown>, setting: SettingSchema): unknown;
/**
 * Test whether a `resolveSettingValue` result is the INVALID sentinel. The sentinel itself is
 * module-private; this predicate is the public seam so `updateSetting` (factory.ts) can apply the
 * update disposition (INVALID → no-update) without re-implementing the gate. (one gate)
 */
export declare function isInvalidResult(value: unknown): boolean;
/**
 * Normalize raw settings using schema definitions.
 * Iterates schema entries, checks aliases, applies parsers, fills defaults.
 * Replaces N-field switch statements with a single data-driven loop.
 */
export declare function normalizeFromSchema(raw: Record<string, unknown>, schema: SettingsSchema): Record<string, unknown>;
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
export declare function validateSchema(schema: SettingsSchema): void;
/**
 * Apply post-normalization clamps for settings with inter-field constraints
 * that cannot be expressed per-field in the schema.
 */
export declare function clampSettings(result: Record<string, unknown>, clampFn: ((result: Record<string, unknown>) => void) | undefined): void;
/**
 * Get the effective value for a setting from raw data.
 * Returns the default if the raw value is invalid.
 */
export declare function getEffectiveValue(raw: Record<string, unknown>, setting: SettingSchema): unknown;
/**
 * Compute the raw internal string value for a setting.
 * Converts null to the appropriate sentinel string.
 */
export declare function computeRawInternalValue(settings: Record<string, unknown>, setting: SettingSchema): string;
/**
 * Normalize a `PresetElement[]` (bare values OR full pairs, possibly MIXED) into `PresetPair[]`
 * at the single resolution seam. Bare string → type-aware `[s, typeDef.parse(s, ctx)]` (duration
 * "30m"→1800000ms, string→identity via an empty-presets ctx, custom types free); bare
 * number/boolean/null → `[String(v), v]`; a full `PresetPair` → as-is. An unparseable bare string
 * THROWS — caught at registration (createSettingsExtension schema validation → fail-fast) or by a
 * resolver's degrade-to-empty for async sources. Downstream stays `PresetPair[]`-based.
 */
export declare function normalizePresetElements(elements: readonly PresetElement[], setting: SettingSchema): PresetPair[];
/**
 * Resolve the EFFECTIVE source of presets for a setting: `setting.presets ?? typeDef.presets`.
 * This is the single source of truth for the override pick — the gate and the UI both go through
 * it. A resolver-function source is flagged `isFunction: true` with empty `pairs` (the gate
 * cannot call a resolver, so it treats it as no presets at load; the UI resolves it once at
 * modal-open). A static-array source yields the pairs directly. Absent at both levels → empty.
 */
export declare function resolveEffectivePresets(setting: SettingSchema): {
    isFunction: boolean;
    pairs: PresetPair[];
};
/**
 * Resolve the STATIC presets for a setting — the pairs the gate can use at load. Resolver-function
 * sources collapse to `[]` here (resolved later by the UI); static-array sources yield their
 * pairs. Thin wrapper over `resolveEffectivePresets` so call sites that only need the pairs keep
 * a stable shape.
 */
export declare function resolveStaticPresets(setting: SettingSchema): PresetPair[];
/**
 * The display label for the null value — the label of the preset pair whose value is null.
 * Returns `undefined` when the setting is NOT nullable (no null pair): callers use this to
 * decide whether null handling applies at all, so a non-nullable timeout correctly rejects
 * "Infinite". For a well-formed nullable setting, a null pair always exists, so the label
 * is fully derived from `presets`. Reads the EFFECTIVE static presets (setting override OR
 * type-def default); resolver-function sources correctly yield `undefined` at load (their null
 * label is resolved from pairs at UI time).
 */
export declare function resolveNullLabel(setting: SettingSchema): string | undefined;
/**
 * The display label for the null value, derived directly from a pairs array. Pure pair-level
 * helper shared by `resolveNullLabel` (via `resolveStaticPresets`) and the UI's resolved-pairs
 * path (a resolver's `[["Default", null], …]` is only available after resolution at open).
 * Returns `undefined` when no pair has a null value.
 */
export declare function resolveNullLabelFromPairs(pairs: readonly PresetPair[]): string | undefined;
/**
 * Build the full `PresetItem[]` (label + rawValue + displayValue) from a pairs array, in display
 * order. Pure pair-level derivation shared by the gate (via `buildPresetItems(setting)`) and the
 * UI's resolved-pairs path. The displayValue is the serialized string form (the null pair
 * serializes to its label, or "Infinite" defensively when no null pair exists).
 */
export declare function buildPresetItemsFromPairs(pairs: readonly PresetPair[]): readonly PresetItem[];
/**
 * Build the full `PresetItem[]` for a setting from its EFFECTIVE static presets. Thin wrapper
 * over `buildPresetItemsFromPairs(resolveStaticPresets(setting))` — kept for its existing tested
 * signature. Resolver-function sources yield `[]` here (resolved by the UI at open).
 */
export declare function buildPresetItems(setting: SettingSchema): readonly PresetItem[];
