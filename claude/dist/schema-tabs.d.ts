import type { PresetPair, SettingsSchema, TabDefinition } from "./schema.js";
/**
 * Build tab groups from a schema + current settings values.
 * Returns TabDefinition[] compatible with SettingsTabsModal.
 *
 * `resolvedPairs` carries the function-presets resolved once at modal-open (the model
 * resolver's live list). Pass `null` for callers without a modal (static-array presets
 * render from the WeakMap cache; function-presets settings render with an empty list).
 */
export declare function buildSchemaTabGroups(settings: Record<string, unknown>, schema: SettingsSchema, resolvedPairs: Map<string, PresetPair[]> | null): TabDefinition[];
