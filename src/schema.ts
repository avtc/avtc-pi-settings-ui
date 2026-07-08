// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Schema-driven settings type definitions.
 *
 * A setting is fully described by a single `SettingSchema` entry.
 * The generic infrastructure auto-generates UI, persistence, normalization,
 * and validation from the schema alone.
 */

/** Setting type hint — drives validation and display formatting.
 *  A bare type-id `string`: the 7 built-in TypeDefinition ids (`number`, `duration`, `compact-threshold`,
 *  `string`, `boolean`, `model`, `thinking-level`) plus any custom type registered via `registerTypeDefinition`. */
export type SettingType = string;

/** The value slot of a preset — the raw typed value a preset selects. */
export type PresetValue = string | number | boolean | null;

/** Ordered preset pair: display label paired with its raw typed value. */
export type PresetPair = readonly [string, PresetValue];

/** A preset source element: a full [label, value] pair, OR a bare value. Bare values are
 *  auto-paired at the resolution seam — a bare string → type-aware [s, parse(s)] (duration
 *  "30m"→1800000, string→identity); a bare number/boolean/null → [String(v), v]. Mixed arrays
 *  ([ ["off", null], "5m", "10m"]) are allowed. */
export type PresetElement = PresetPair | PresetValue;

/** Source of presets for a setting: a static element array OR a resolver function.
 *  Declared at two levels — a type-def default (`TypeDefinition.presets`) overridable by the
 *  setting's own `presets` (authoritative). The static array is resolved at the gate; the
 *  resolver is resolved once at modal-open (the gate cannot call a resolver, so it treats a
 *  resolver as no presets at load). */
export type PresetsSource =
  | readonly PresetElement[]
  | (() => readonly PresetElement[] | Promise<readonly PresetElement[]>);

/** Schema for a single setting. */
export interface SettingSchema<T = unknown> {
  /** Unique key (e.g. "codeReviewLoops") */
  id: string;
  /** Display label ("Code review loops") */
  label: string;
  /** Shown when selected in settings UI */
  description?: string;
  /** Validation/display hint */
  type: SettingType;
  /** Inclusive numeric floor (for `number`/`duration` types whose `TypeDefinition.bounded` is true). */
  min?: number;
  /** Inclusive numeric ceiling (for bounded numeric/duration types). */
  max?: number;
  /** Default value. Use `undefined` for intentionally absent defaults. */
  defaultValue: T;
  /**
   * Presets for this setting. When set, this OVERRIDES the type-def's default presets
   * (replace, not merge). When absent, the type-def's default presets (if any) apply.
   * Either level may be a static pair array (resolved at the gate) or a resolver function
   * (resolved once at modal-open). Order is the display order — immune to JS integer-index
   * key reordering. The library derives labels, internal value strings, the label→value map,
   * AND the null display label (the label of the pair whose value is null) from this in one
   * atomic pass.
   */
  presets?: PresetsSource;
  /** Backward-compat field names (old keys that map to this setting's canonical id). */
  aliases?: string[];
  /** Legacy value aliases: old value → current raw value. Resolved before value-based matching. */
  valueAliases?: Record<string, string | number | boolean | null>;
}

/** Schema for a settings tab. */
export interface SettingsTabSchema {
  /** Tab label ("Review") */
  label: string;
  /** Ordered list of setting IDs in this tab */
  settingIds: string[];
}

/** Full settings schema — defines all settings, tabs, and file paths. */
export interface SettingsSchema {
  /** All setting definitions */
  settings: SettingSchema[];
  /** Tab layout */
  tabs: SettingsTabSchema[];
  /** Where global settings file lives */
  globalPath: (globalDir?: string) => string;
  /** Where project settings file lives */
  projectPath: (cwd: string) => string;
}

/** Tab definition for UI rendering. */
export interface TabDefinition {
  label: string;
  settings: SettingItem[];
}

/** A single preset entry: display label paired with its raw typed value and serialized form. */
export interface PresetItem {
  label: string;
  /** Raw typed value (passed to updateSetting for value-based matching). */
  rawValue: string | number | boolean | null;
  /** Serialized string form (for current-value index matching against currentRawValue). */
  displayValue: string;
}

/** Single setting item in a tab. */
export interface SettingItem {
  id: string;
  label: string;
  value: string;
  displayValue: string;
  type: SettingType;
  description?: string;
  /** Cohesive preset list (labels + raw values + display strings derived from `presets` pairs). */
  presets?: readonly PresetItem[];
}

// ── Storage levels (which persistence targets a settings handle offers) ─────────

/** A persistence target a settings handle / modal may offer. */
export type StorageLevel = "session" | "project" | "global";

/** The full set of levels, in canonical order. */
export const DEFAULT_STORAGE_LEVELS: readonly StorageLevel[] = ["session", "project", "global"];

/** Valid level strings (for normalization / typo rejection). */
export const VALID_STORAGE_LEVELS: ReadonlySet<StorageLevel> = new Set<StorageLevel>(DEFAULT_STORAGE_LEVELS);

/**
 * Normalize a consumer-supplied `storageLevels`: drop unknown/duplicate entries, fall back to
 * the full default set when nothing valid remains. Deduping/validating BEFORE the count rule
 * prevents duplicates or typos from silently flipping single-level → multi-level mode.
 */
export function normalizeStorageLevels(levels: StorageLevel[] | undefined): StorageLevel[] {
  if (!levels || levels.length === 0) return [...DEFAULT_STORAGE_LEVELS];
  const seen = new Set<StorageLevel>();
  const out: StorageLevel[] = [];
  for (const level of levels) {
    if (VALID_STORAGE_LEVELS.has(level) && !seen.has(level)) {
      seen.add(level);
      out.push(level);
    }
  }
  return out.length > 0 ? out : [...DEFAULT_STORAGE_LEVELS];
}
