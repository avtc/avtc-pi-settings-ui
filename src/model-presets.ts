// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * The model presets resolver — the default `presets` source for the `model` type-def. Reads the
 * host's model registry (captured at modal-open), keeps only the enabled models, and returns the
 * `[label, value]` pairs the picker renders. Resolved once at open (by `resolveFunctionPresets`),
 * so the list reflects the live models.json / auth state on each open.
 *
 * Value shape: `"<provider>/<id>"` (the form pi's own model selector pushes), with a leading
 * `["Default", null]` pair so a model setting can be unset. Labels mirror pi's selector:
 * `"<id> [<provider>]"`.
 */

import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { minimatch } from "minimatch";
import { getCapturedCtx } from "./ctx-store.js";
import { readJsonFile } from "./persistence.js";
import type { PresetPair } from "./schema.js";

/** The model fields `modelLabel` reads. Structural so any model-like object works. */
interface ModelLike {
  readonly id: string;
  readonly provider: string;
}

/** The null entry — a model setting is always selectable as "Default" (unset). */
const DEFAULT_PAIR: PresetPair = ["Default", null];

/**
 * Format a model as `"<id> [<provider>]"` — the same shape pi's own model selector renders (the
 * provider sits in a muted badge there; the raw provider id is used, not a display name).
 */
export function modelLabel(model: ModelLike): string {
  return `${model.id} [${model.provider}]`;
}

/** The serialized value for a model: `"<provider>/<id>"` (pi's full-id form). */
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
 * Read the host's enabled-models patterns from its settings file. Returns `null` when the file is
 * absent or carries no `enabledModels` (meaning "no scoping — all available models"). Exposed as a
 * seam so the resolver can be unit-tested without touching the real settings path.
 */
export function readEnabledModelPatterns(): string[] | null {
  const raw = readJsonFile(join(getAgentDir(), "settings.json"));
  const patterns = raw?.enabledModels;
  return Array.isArray(patterns) ? patterns : null;
}

/**
 * Keep a model iff any enabled-models pattern matches it — either its full `provider/id` or its
 * bare `id`. Matching is case-insensitive (pi resolves scopes nocase). A pattern without glob
 * metacharacters matches as a literal under minimatch, so a full id like `anthropic/claude-3-5`
 * matches exactly the same way a glob like `anthropic/*` does.
 *
 * Two deviations from pi's own resolver: a non-glob partial name (e.g. `claude`) does not get
 * fuzzy-matched against model display names, and a trailing `:thinkingLevel` suffix on a pattern
 * is not stripped (thinking levels are ignored here).
 */
function isEnabled(model: ModelLike, patterns: readonly string[]): boolean {
  const fullId = modelValue(model);
  return patterns.some(
    (pattern) => minimatch(fullId, pattern, { nocase: true }) || minimatch(model.id, pattern, { nocase: true }),
  );
}

/**
 * Resolve the model presets: the captured registry's available models, scoped by the host's
 * enabled-models patterns, each `[modelLabel(model), "provider/id"]`, with `["Default", null]`
 * prepended. When the registry was not captured, or enabled-models patterns are configured but
 * match nothing, the list degrades to `["Default", null]` (the modal still opens).
 *
 * Async because `modelRegistry.refresh()` is async on pi 0.80.8+ (it reloads models.json
 * asynchronously). Awaiting it guarantees the subsequent synchronous `getAvailable()` reads
 * the freshly loaded list rather than a stale one. On older pi (where refresh returned void)
 * `await`-ing a non-promise is a no-op, so this is forward- and backward-compatible.
 */
export async function resolveModelPresets(): Promise<PresetPair[]> {
  const { modelRegistry } = getCapturedCtx();
  if (!modelRegistry) return [DEFAULT_PAIR];

  await modelRegistry.refresh();
  const all = modelRegistry.getAvailable();
  const patterns = readEnabledModelPatterns();

  // null/absent enabledModels → no scoping (all available). Non-null but matching nothing → also
  // fall back to all (a stale/typo pattern should not empty the picker).
  const scoped = patterns === null ? all : all.filter((m) => isEnabled(m, patterns));
  const effective = scoped.length > 0 ? scoped : all;

  return [DEFAULT_PAIR, ...effective.map((m): PresetPair => [modelLabel(m), modelValue(m)])];
}
