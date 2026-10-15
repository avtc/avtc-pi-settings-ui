import type { PresetPair, PresetsSource } from "./schema.js";
/** Per-call context handed to a `TypeDefinition`'s parse/format/prefill. */
export interface TypeContext {
    /** Effective presets for this setting, as `[label, value]` pairs. */
    presets: readonly PresetPair[];
    /** Inclusive numeric floor (from `SettingSchema.min`). */
    min?: number;
    /** Inclusive numeric ceiling (from `SettingSchema.max`). */
    max?: number;
}
/** A first-class setting type. `T` is the parsed/kept JS value type (defaults to `unknown`). */
export interface TypeDefinition<T = unknown> {
    /** Type id ("number" | "duration" |... | <custom>); matches `SettingSchema.type`. */
    id: string;
    /** `typeof` of the parsed/kept value — drives the gate's step-5 type-match. */
    valueType: "number" | "string" | "boolean";
    /** string → value | invalid. Invalid MUST return `undefined`, never `null` (null is a preset value). */
    parse(input: string, ctx: TypeContext): T | undefined;
    /** value → display string. */
    format(value: T, ctx: TypeContext): string;
    /** Custom-input seed; defaults to `format` when absent. */
    toInputPrefill?(value: T, ctx: TypeContext): string;
    /** Can the user type free-form input for this type? */
    supportsCustomValues: boolean;
    /** Hint shown in the custom-value picker. */
    errorMessage: string;
    /** When true, the gate applies `min`/`max` bounds (number/duration). */
    bounded?: boolean;
    /**
     * Optional DEFAULT presets for this type — overridden by `SettingSchema.presets` (replace, not
     * merge) when the setting declares its own. Either level may be a static pair array (resolved
     * at the gate) or a resolver function (resolved once at modal-open, e.g. a model list read
     * from the registry). Absent means this type offers no default presets.
     */
    presets?: PresetsSource;
    /**
     * Inherently nullable: `null` is always a valid value for this type, even when the
     * effective presets yield no null pair at gate time (a resolver-function presets
     * source — e.g. the model list — resolves its `["Default", null]` pair only at
     * modal-open, so the write gate would otherwise reject null and a model setting
     * could never be unset back to Default).
     */
    nullable?: boolean;
}
/**
 * Register a setting type (built-ins are pre-registered at module load; extensions call this at
 * startup for custom types). Stored as `TypeDefinition<unknown>` so heterogeneous definitions
 * share one registry — the concrete `T` is an asserted shape, the same trust model as the gate.
 */
export declare function registerTypeDefinition<T>(def: TypeDefinition<T>): void;
/** Look up a setting type by id — the single lookup replacing every type-keyed switch. */
export declare function getTypeDefinition(typeId: string): TypeDefinition;
/**
 * Coerce a serialized raw string to the type's JS value for `format`/`toInputPrefill`.
 * Number-typed values are stored as numeric strings; this coerces them to a real number so
 * `format(300000)` renders `"5m"` rather than failing. A non-numeric string (e.g. the null-label
 * on a preset-less setting) falls back to the raw string. Used by schema-tabs (display) and
 * value-picker (prefill) — the single coercion replacing their duplicated inline logic.
 */
export declare function coerceTypedValue(rawValue: string, typeDef: TypeDefinition): string | number;
/**
 * Format a serialized raw value for display via the TypeDefinition. Coerces the raw string to
 * the type's JS value, then formats it. A non-numeric result (e.g. the null-label "Infinite" on
 * a preset-less setting) is returned verbatim rather than fed through `format` (which would
 * render "NaNs" for durations). The single display-format site shared by schema-tabs (list
 * display) and value-picker (prefill) — keeps the NaN guard from drifting between them.
 */
export declare function formatRawForDisplay(rawValue: string, typeDef: TypeDefinition, ctx: TypeContext): string;
/**
 * The boolean choices, as `[label, value]` preset pairs (label equals value). The default
 * `presets` for the `boolean` type — a consumer writes only `{ type: "boolean" }` and gets
 * these without declaring `presets` (overridable per-setting: replace, not merge). Without
 * them a boolean resolves to no presets, so the value picker would surface only the current
 * value (e.g. just "False") with nothing to toggle to.
 */
export declare const BOOLEAN_PRESETS: readonly [readonly ["true", true], readonly ["false", false]];
/**
 * The seven thinking levels, as `[label, value]` preset pairs (label equals value). The default
 * `presets` for the `thinking-level` type — a consumer writes only `{ type: "thinking-level" }`
 * and gets these without declaring `presets` (overridable per-setting: replace, not merge).
 */
export declare const THINKING_LEVEL_PRESETS: readonly [readonly ["off", "off"], readonly ["minimal", "minimal"], readonly ["low", "low"], readonly ["medium", "medium"], readonly ["high", "high"], readonly ["xhigh", "xhigh"], readonly ["max", "max"]];
