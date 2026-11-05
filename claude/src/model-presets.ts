// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * The model presets resolver — the default `presets` source for the `model`
 * type-def. Reads the models the HOST captured at pane-open (no registry or
 * settings file is read here — the host injects both the list and the
 * enabled-models patterns), and returns the `[label, value]` pairs the picker
 * renders.
 *
 * Value shape: `"<provider>/<id>"`, with a leading `["Default", null]` pair
 * so a model setting can be unset. Labels render as `"<id> [<provider>]"`.
 */

import { getCapturedCtx } from "./ctx-store.js";
import type { PresetPair } from "./schema.js";

/** The model fields `modelLabel` reads. Structural so any model-like object works. */
export interface ModelLike {
  readonly id: string;
  readonly provider: string;
}

/** The null entry — a model setting is always selectable as "Default" (unset). */
const DEFAULT_PAIR: PresetPair = ["Default", null];

/**
 * Format a model as `"<id> [<provider>]"` — the same shape the host's own
 * model selector renders (the raw provider id is used, not a display name).
 */
export function modelLabel(model: ModelLike): string {
  return `${model.id} [${model.provider}]`;
}

/** The serialized value for a model: `"<provider>/<id>"` (the full-id form). */
function modelValue(model: ModelLike): string {
  return `${model.provider}/${model.id}`;
}

/** Split a serialized model value `"<provider>/<id>"` on the FIRST slash, so an id that itself
 *  contains a slash still resolves by its leading provider/id segments. Returns `null` when the
 *  value has no slash (not a `provider/id` form — e.g. the null/"Default" entry). */
export function splitModelId(value: string): { provider: string; id: string } | null {
  const slash = value.indexOf("/");
  if (slash < 0) return null;
  return { provider: value.slice(0, slash), id: value.slice(slash + 1) };
}

/** A `modelPicker.options` entry reduced to its usable fields (label absent when
 *  the user never named the row). */
interface PickerOption {
  readonly model: string;
  readonly label: string | undefined;
}

/** Labeled `[label, value]` rows for the user's own models, read from a Claude
 *  Code settings snapshot (the `$.settings.read` shape):
 *
 * - each `availableModels` entry becomes a row — the value verbatim (an id the
 *   host's own model selection accepts), labeled from `modelPicker.options`
 *   when the user named it there
 * - `modelPicker.options` entries no `availableModels` entry names append after
 *   them (their own label, or the id), so a picker lineup alone still yields rows
 *
 * `reservedValues` are engine values the caller already offers its own way
 * (aliases, spawn keywords) — they never become rows here. Malformed shapes
 * (non-arrays, non-strings, bad options) collapse to zero rows; never throws. */
export function modelPairsFromSettings(settings: unknown, reservedValues: ReadonlySet<string>): PresetPair[] {
  if (settings === null || typeof settings !== "object") return [];
  const root = settings as Record<string, unknown>;

  const pickerOptions: PickerOption[] = [];
  const labels = new Map<string, string>();
  const picker = root.modelPicker;
  if (picker !== null && typeof picker === "object") {
    const options = (picker as Record<string, unknown>).options;
    if (Array.isArray(options)) {
      for (const option of options) {
        if (option === null || typeof option !== "object") continue;
        const model = (option as Record<string, unknown>).model;
        const label = (option as Record<string, unknown>).label;
        if (typeof model !== "string" || model.trim().length === 0) continue;
        const trimmedModel = model.trim();
        const labelStr = typeof label === "string" && label.length > 0 ? label : undefined;
        pickerOptions.push({ model: trimmedModel, label: labelStr });
        if (labelStr) labels.set(trimmedModel, labelStr);
      }
    }
  }

  const pairs: PresetPair[] = [];
  const seen = new Set<string>();
  const raw = root.availableModels;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      const value = entry.trim();
      if (value.length === 0 || seen.has(value)) continue;
      if (reservedValues.has(value.toLowerCase())) continue;
      seen.add(value);
      pairs.push([labels.get(value) ?? value, value]);
    }
  }
  for (const option of pickerOptions) {
    if (seen.has(option.model)) continue;
    if (reservedValues.has(option.model.toLowerCase())) continue;
    seen.add(option.model);
    pairs.push([option.label ?? option.model, option.model]);
  }
  return pairs;
}

/**
 * Glob match over the minimatch subset patterns use: `*` (any run), `?`
 * (exactly one), everything else literal; case-insensitive. No brace
 * expansion, extglobs or `**` segmentation — enabled-models patterns are
 * simple (`anthropic/*`, `claude-*`).
 */
export function globMatch(text: string, pattern: string): boolean {
  const SPECIAL = ".?[]{}()^$\\|+*";
  let re = "^";
  for (const ch of pattern) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += SPECIAL.includes(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`${re}$`, "i").test(text);
}

/**
 * Keep a model iff any enabled-models pattern matches it — either its full
 * `provider/id` or its bare `id`. A pattern without glob metacharacters
 * matches as a literal, so a full id like `anthropic/claude-3-5` matches
 * exactly the same way a glob like `anthropic/*` does.
 */
export function isEnabled(model: ModelLike, patterns: readonly string[]): boolean {
  const fullId = modelValue(model);
  return patterns.some((pattern) => globMatch(fullId, pattern) || globMatch(model.id, pattern));
}

/**
 * Resolve the model presets: the captured models list, scoped by the captured
 * enabled-models patterns (null/absent = no scoping), each
 * `[modelLabel(model), "provider/id"]`, with `["Default", null]` prepended.
 * When nothing was captured, or the patterns match nothing, the list degrades
 * to `["Default", null]` (the pane still opens).
 *
 * Both inputs come from the context captured at pane-open — the host injects
 * the models list and reads its own enabled-models setting.
 */
export async function resolveModelPresets(): Promise<PresetPair[]> {
  const { models, enabledModelPatterns, staticModelPairs } = getCapturedCtx();
  const statics = staticModelPairs ?? [];
  if ((!models || models.length === 0) && statics.length === 0) return [DEFAULT_PAIR];
  if (!models || models.length === 0) return [DEFAULT_PAIR, ...statics];

  // null/absent enabledModels → no scoping (all captured). Non-null but
  // matching nothing → also fall back to all (a stale/typo pattern must not
  // empty the picker).
  const scoped =
    enabledModelPatterns === null || enabledModelPatterns === undefined
      ? models
      : models.filter((m) => isEnabled(m, enabledModelPatterns));
  const effective = scoped.length > 0 ? scoped : models;

  return [DEFAULT_PAIR, ...statics, ...effective.map((m): PresetPair => [modelLabel(m), modelValue(m)])];
}
