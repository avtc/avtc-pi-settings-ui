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
