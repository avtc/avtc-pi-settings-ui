// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Schema-driven tab group builder.
 *
 * Converts a SettingsSchema + current settings values into the TabDefinition[]
 * format expected by SettingsTabsModal. Handles display formatting for all
 * setting types (durations, compact thresholds, presetLabels mapping, etc).
 */

import {
  buildPresetItems,
  buildPresetItemsFromPairs,
  computeRawInternalValue,
  resolveEffectivePresets,
  resolveNullLabelFromPairs,
} from "../normalization.js";
import type { PresetItem, PresetPair, SettingItem, SettingSchema, SettingsSchema, TabDefinition } from "../schema.js";
import { formatRawForDisplay, getTypeDefinition, type TypeContext } from "../type-definitions.js";

/**
 * Format a raw internal value for display in the settings list.
 * Display formatting is `getTypeDefinition(type).format` — the old type-discriminant switch (whose
 * `default` returned raw ms) is gone, so a `duration` value renders as `"30s"`, not `"30000"`.
 * Preset-matched values (the `"Infinite"`/`"Never"` preset labels) are still resolved by the
 * preset-label map at the top — unaffected.
 */
function formatSettingDisplay(rawValue: string, settingType: string, presets: readonly PresetItem[]): string {
  if (rawValue === "") return rawValue;

  // Map a raw internal value to its preset label.
  if (presets.length) {
    const match = presets.find((p) => p.displayValue === rawValue);
    if (match) return match.label;
  }

  const typeDef = getTypeDefinition(settingType);
  // Build a minimal TypeContext (format rarely needs it; compact-threshold format is identity).
  const ctx: TypeContext = { presets: presets.map((p): PresetPair => [p.label, p.rawValue]) };

  // Format the raw value for display (coerce → typeof-number-guard → format). Shared with
  // value-picker so the NaN guard can't drift between the two display paths.
  return formatRawForDisplay(rawValue, typeDef, ctx);
}

/**
 * Memoized cohesive preset list per setting schema.
 * Schemas are immutable references, so WeakMap lets us compute the PresetItem[] once
 * per schema instead of on every interactive rebuild (arrow-key nav, value change).
 * Only STATIC-array effective presets are cached: resolved function-presets are fresh per
 * modal-open (the live model list changes between opens), so they bypass this cache.
 */
const presetsCache = new WeakMap<SettingSchema, readonly PresetItem[]>();

/**
 * Build tab groups from a schema + current settings values.
 * Returns TabDefinition[] compatible with SettingsTabsModal.
 *
 * `resolvedPairs` carries the function-presets resolved once at modal-open (the model
 * resolver's live list). Pass `null` for callers without a modal (static-array presets
 * render from the WeakMap cache; function-presets settings render with an empty list).
 */
export function buildSchemaTabGroups(
  settings: Record<string, unknown>,
  schema: SettingsSchema,
  resolvedPairs: Map<string, PresetPair[]> | null,
): TabDefinition[] {
  const pairsMap = resolvedPairs;

  /**
   * Preset items for a setting. Static-array sources read the WeakMap cache; function
   * sources read the per-open resolved map fresh (never cached — the model list changes
   * between opens). If a resolver returned no pairs (threw/rejected), the list is empty.
   */
  const getPresets = (
    setting: SettingSchema,
    eff: ReturnType<typeof resolveEffectivePresets>,
  ): readonly PresetItem[] => {
    if (eff.isFunction) {
      const pairs = pairsMap?.get(setting.id) ?? [];
      return buildPresetItemsFromPairs(pairs);
    }
    let cached = presetsCache.get(setting);
    if (!cached) {
      cached = buildPresetItems(setting);
      presetsCache.set(setting, cached);
    }
    return cached;
  };

  const result: TabDefinition[] = [];
  // Build O(1) lookup map for settings by id
  const settingMap = new Map(schema.settings.map((s) => [s.id, s]));

  for (const tabDef of schema.tabs) {
    const items: SettingItem[] = [];

    for (const settingId of tabDef.settingIds) {
      const settingSchema = settingMap.get(settingId);
      if (!settingSchema) continue;

      const eff = resolveEffectivePresets(settingSchema);
      const presetItems = getPresets(settingSchema, eff);
      let rawValue = computeRawInternalValue(settings, settingSchema);

      // A function-presets setting derives its null label from the resolved pairs (e.g. the
      // model resolver's ["Default", null]): when the value is null/undefined (the static
      // "Infinite" fallback), override it with the resolved null label so a null model shows
      // "Default". Checks the structural value (not the display string) so a literal "Infinite"
      // string value is never mistaken for a null.
      if (eff.isFunction) {
        const original = settings[settingSchema.id];
        if ((original === null || original === undefined) && pairsMap?.has(settingSchema.id)) {
          const resolvedNull = resolveNullLabelFromPairs(pairsMap.get(settingSchema.id) ?? []);
          if (resolvedNull) rawValue = resolvedNull;
        }
      }

      const displayValue = formatSettingDisplay(rawValue, settingSchema.type, presetItems);

      items.push({
        id: settingSchema.id,
        label: settingSchema.label,
        value: rawValue,
        displayValue,
        type: settingSchema.type,
        description: settingSchema.description,
        presets: presetItems,
      });
    }

    result.push({
      label: tabDef.label,
      settings: items,
    });
  }

  return result;
}
