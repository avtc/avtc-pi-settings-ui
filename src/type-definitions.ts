// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * First-class setting types — the `TypeDefinition` registry.
 *
 * Each setting `type` is a registered `TypeDefinition` that owns its value↔string conversion
 * and metadata. Seven built-ins ship; any extension can register more via
 * `registerTypeDefinition` (same code path as the built-ins).
 *
 * Null/0/bounds/presets stay owned by `SettingSchema` + `presets` — a type only owns how a
 * string becomes a value and back, plus a few metadata fields. The single normalization gate
 * (of the design) consults `getTypeDefinition(type)` for parse/format/valueType/bounded.
 */

import { getCapturedCtx } from "./ctx-store.js";
import { modelLabel, resolveModelPresets, splitModelId } from "./model-presets.js";
import type { PresetPair, PresetsSource } from "./schema.js";
import {
  formatCompactThreshold,
  formatHumanDuration,
  isCompactThreshold,
  parseCompactThreshold,
  parseHumanDuration,
} from "./validation.js";

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
}

// ── Registry ────────────────────────────────────────────────────────────────

const registry = new Map<string, TypeDefinition>();

/**
 * Register a setting type (built-ins are pre-registered at module load; extensions call this at
 * startup for custom types). Stored as `TypeDefinition<unknown>` so heterogeneous definitions
 * share one registry — the concrete `T` is an asserted shape, the same trust model as the gate.
 */
export function registerTypeDefinition<T>(def: TypeDefinition<T>): void {
  registry.set(def.id, def as TypeDefinition<unknown>);
}

/** Look up a setting type by id — the single lookup replacing every type-keyed switch. */
export function getTypeDefinition(typeId: string): TypeDefinition {
  const def = registry.get(typeId);
  if (!def) throw new Error(`Unknown setting type: ${typeId}`);
  return def;
}

/**
 * Coerce a serialized raw string to the type's JS value for `format`/`toInputPrefill`.
 * Number-typed values are stored as numeric strings; this coerces them to a real number so
 * `format(300000)` renders `"5m"` rather than failing. A non-numeric string (e.g. the null-label
 * on a preset-less setting) falls back to the raw string. Used by schema-tabs (display) and
 * value-picker (prefill) — the single coercion replacing their duplicated inline logic.
 */
export function coerceTypedValue(rawValue: string, typeDef: TypeDefinition): string | number {
  if (typeDef.valueType === "number") {
    const num = Number(rawValue);
    return Number.isNaN(num) ? rawValue : num;
  }
  return rawValue;
}

/**
 * Format a serialized raw value for display via the TypeDefinition. Coerces the raw string to
 * the type's JS value, then formats it. A non-numeric result (e.g. the null-label "Infinite" on
 * a preset-less setting) is returned verbatim rather than fed through `format` (which would
 * render "NaNs" for durations). The single display-format site shared by schema-tabs (list
 * display) and value-picker (prefill) — keeps the NaN guard from drifting between them.
 */
export function formatRawForDisplay(rawValue: string, typeDef: TypeDefinition, ctx: TypeContext): string {
  // Run the type's format on the display path, else return the verbatim raw string.
  // - number valueType: coerce to a number and format, but only when the raw is actually numeric —
  //   a non-numeric raw (e.g. the null-label 'Infinite') is returned verbatim so format() never
  //   receives a value it can't render.
  // - string valueType: format the raw directly (e.g. the model type resolves provider/id → its
  //   display label). coerceTypedValue is an identity for string valueTypes, so the raw is the value.
  // - boolean: returned verbatim (its 'true'/'false' raw already equals its format output).
  if (typeDef.valueType === "number") {
    const coerced = coerceTypedValue(rawValue, typeDef);
    return typeof coerced === "number" ? typeDef.format(coerced, ctx) : rawValue;
  }
  return typeDef.valueType === "string" ? typeDef.format(rawValue, ctx) : rawValue;
}

// ── Built-in parse helpers ──────────────────────────────────────────────────

/**
 * Parse an integer (the `number` type's parser). Accepts ANY integer — including negatives and
 * zero — and does NOT floor/clamp; out-of-range rejection is the gate's job (7, via `min`/`max`),
 * not the parser's.
 */
function parseInteger(input: string): number | undefined {
  const trimmed = input.trim();
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  return parseInt(trimmed, 10);
}

/**
 * Parse a duration (the `duration` type's parser): human form via `parseHumanDuration`
 * (e.g. "30s", "5m", "1d", "0s") with a bare-millisecond `Number(input)` fallback so a plain numeric
 * string like "300000" still parses. Zero is a valid duration — range rejection (e.g. min > 0)
 * is the gate's job (via `min`/`max`), not the parser's, matching the `number` type's contract.
 * Negative/invalid → undefined.
 */
function parseDuration(input: string): number | undefined {
  if (input.trim() === "") return undefined;
  const ms = parseHumanDuration(input);
  if (ms !== undefined && ms >= 0) return ms;
  const num = Number(input);
  if (!Number.isNaN(num) && num >= 0) return num;
  return undefined;
}

/**
 * Match a preset by its label OR its raw value. Shared membership check — both the
 * compact-threshold parser and the thinking-level parser validate input against the effective
 * presets rather than keeping their own copy of the values.
 */
function matchPresetValue(input: string, ctx: TypeContext): string | undefined {
  for (const [label, value] of ctx.presets) {
    if (label === input || String(value) === input) {
      return value as string;
    }
  }
  return undefined;
}

// ── The built-in TypeDefinitions ───────────────────────────────────────────

const numberType: TypeDefinition<number> = {
  id: "number",
  valueType: "number",
  parse: (input) => parseInteger(input),
  format: (value) => String(value),
  supportsCustomValues: true,
  errorMessage: "Enter a whole number",
  bounded: true,
};

const durationType: TypeDefinition<number> = {
  id: "duration",
  valueType: "number",
  parse: (input) => parseDuration(input),
  format: (value) => formatHumanDuration(value),
  supportsCustomValues: true,
  errorMessage: "Enter a duration (e.g. 30s, 5m, 7d)",
  bounded: true,
};

/** Canonical off/force sentinels for the compact-threshold type — the "never" and "always"
 *  states alongside the `compact>NK` "when exceeding" form. Identity-valued (label === value).
 *  Recognized by {@link compactThresholdType}'s parse so a consumer can declare them as bare preset
 *  strings (`presets: ["none", "compact", "compact>75K", ...]`). */
const COMPACT_THRESHOLD_SENTINELS = new Set(["none", "compact"]);

const compactThresholdType: TypeDefinition<string> = {
  id: "compact-threshold",
  valueType: "string",
  parse: (input, ctx) => {
    // 1. preset value (by label or raw value)
    const preset = matchPresetValue(input, ctx);
    if (preset !== undefined) return preset;
    // 2. already-canonical compact>NK
    if (isCompactThreshold(input)) return input;
    // 3. canonical off/force sentinels (never / always)
    if (COMPACT_THRESHOLD_SENTINELS.has(input)) return input;
    // 4. numeric string → compact>NK
    return parseCompactThreshold(input);
  },
  format: (value) => value,
  toInputPrefill: (value) => formatCompactThreshold(value),
  supportsCustomValues: true,
  errorMessage: "Enter a compact threshold (e.g. 300)",
};

const stringType: TypeDefinition<string> = {
  id: "string",
  valueType: "string",
  // Closed enum when effective presets exist: a value must match a preset's label OR raw value,
  // else INVALID (the gate resets to default + logs). No presets → free-form identity (a value
  // like baseBranch survives). Closed enums are ALSO enforced UI-side (supportsCustomValues: false).
  parse: (input, ctx) => (ctx.presets.length > 0 ? matchPresetValue(input, ctx) : input),
  format: (value) => value,
  supportsCustomValues: false, // closed enums are enforced UI-side
  errorMessage: "Select a value",
};

const booleanType: TypeDefinition<boolean> = {
  id: "boolean",
  valueType: "boolean",
  parse: (input) => {
    if (input === "true") return true;
    if (input === "false") return false;
    return undefined;
  },
  format: (value) => String(value),
  supportsCustomValues: false,
  errorMessage: "Select true or false",
};

// ── The thinking-level built-in ─────────────────────────────────────────────

/**
 * The six thinking levels, as `[label, value]` preset pairs (label equals value). The default
 * `presets` for the `thinking-level` type — a consumer writes only `{ type: "thinking-level" }`
 * and gets these without declaring `presets` (overridable per-setting: replace, not merge).
 */
export const THINKING_LEVEL_PRESETS = [
  ["off", "off"],
  ["minimal", "minimal"],
  ["low", "low"],
  ["medium", "medium"],
  ["high", "high"],
  ["xhigh", "xhigh"],
] as const satisfies readonly PresetPair[];

const thinkingLevelType: TypeDefinition<string> = {
  id: "thinking-level",
  valueType: "string",
  // Membership check against the EFFECTIVE presets (the type-def default, or a per-setting
  // override). An unknown level returns undefined → the load gate rejects it and falls back to
  // the setting's defaultValue.
  parse: (input, ctx) => matchPresetValue(input, ctx),
  format: (value) => value,
  presets: THINKING_LEVEL_PRESETS,
  supportsCustomValues: false,
  errorMessage: "Select a thinking level",
};

// ── The model built-in ───────────────────────────────────────────────────────

/**
 * Resolve a stored `"provider/id"` value to its display label via the captured registry. A stale
 * id (one the registry has no record of) renders verbatim rather than failing. When no
 * registry was captured, the raw value is returned unchanged (graceful — never dereferences an
 * absent registry). The provider/id are split on the FIRST slash so an id containing a slash still
 * resolves by its leading provider/id segments.
 */
function formatModelValue(value: string): string {
  const parts = splitModelId(value);
  if (!parts) return value;
  const found = getCapturedCtx().modelRegistry?.find(parts.provider, parts.id);
  return found ? modelLabel(found) : value;
}

const modelType: TypeDefinition<string> = {
  id: "model",
  valueType: "string",
  // Identity parse — a provider/id (even a stale one) loads unchanged. Null is valid via the
  // gate's null-preset path (the resolver's ['Default', null] pair), not via parse.
  parse: (input) => input,
  format: (value) => formatModelValue(value),
  presets: resolveModelPresets,
  supportsCustomValues: false,
  errorMessage: "Select a model",
};

// Pre-register the 7 built-ins at module load.
registerTypeDefinition(numberType);
registerTypeDefinition(durationType);
registerTypeDefinition(compactThresholdType);
registerTypeDefinition(stringType);
registerTypeDefinition(booleanType);
registerTypeDefinition(thinkingLevelType);
registerTypeDefinition(modelType);
