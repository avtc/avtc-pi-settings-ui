// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * UI-time batch resolution of function-`presets` sources.
 *
 * A setting whose effective `presets` is a function (the model resolver) is resolved
 * once, at modal-open, into a map of pairs keyed by setting id. The map is threaded
 * into `buildSchemaTabGroups` so the UI renders the resolved options. Resolvers take
 * no arguments — they read captured context themselves. A resolver that throws or
 * rejects degrades to an empty list, so one failing resolver never breaks the batch.
 */

import { normalizePresetElements, resolveEffectivePresets } from "./normalization.js";
import type { PresetElement, PresetPair, SettingSchema, SettingsSchema } from "./schema.js";
import { getTypeDefinition } from "./type-definitions.js";

/**
 * The pairs substituted when a resolver throws or rejects. A named const (not a bare
 * `[]`) so the element type is carried: a bare `[]` in `.catch(() => [])` infers
 * `never[]`, which won't widen to `PresetPair[]` for the resolved-entry tuple.
 */
const EMPTY_PRESET_PAIRS: readonly PresetPair[] = [];

/** Pick the effective presets source (setting override OR type-def default) as a function. */
function getResolverFn(setting: SettingSchema): () => PresetElement[] | Promise<PresetElement[]> {
  const src = setting.presets ?? getTypeDefinition(setting.type).presets;
  return src as () => PresetElement[] | Promise<PresetElement[]>;
}

/** Result of resolving a schema's function-presets: the resolved pairs plus any that failed. */
export interface ResolvedPresets {
  /** Setting id → resolved preset pairs (empty list for a setting whose resolver failed). */
  pairs: Map<string, PresetPair[]>;
  /** Ids of settings whose resolver threw or rejected. Caller surfaces these to the user. */
  failedIds: readonly string[];
}

/**
 * Resolve every function-`presets` setting in the schema.
 *
 * Static-array presets are ignored here (they stay WeakMap-cached in the tab builder);
 * only function sources are resolved. Each resolver is invoked with no arguments and
 * guarded so a synchronous throw or an async rejection becomes an empty pairs list —
 * one failing resolver never breaks the batch. Failing setting ids are collected in
 * `failedIds` so the caller can warn the user (the modal still opens with defaults).
 */
export async function resolveFunctionPresets(schema: SettingsSchema): Promise<ResolvedPresets> {
  const resolverSettings = schema.settings.filter((s) => resolveEffectivePresets(s).isFunction);
  const failedIds: string[] = [];
  const entries = await Promise.all(
    resolverSettings.map((s) =>
      Promise.resolve()
        .then(async () => normalizePresetElements(await getResolverFn(s)(), s))
        .catch(() => {
          // Degrade to an empty list so the batch (and the modal) survive — covers both a resolver
          // that throws/rejects AND a bad bare string in its result (normalizePresetElements throws).
          // Record the id so the caller can tell the user this setting's options could not load.
          failedIds.push(s.id);
          return EMPTY_PRESET_PAIRS;
        })
        .then((pairs): readonly [string, PresetPair[]] => [s.id, [...pairs]]),
    ),
  );
  return { pairs: new Map(entries), failedIds };
}
