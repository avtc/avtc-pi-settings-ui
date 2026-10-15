import type { PresetPair, SettingsSchema } from "./schema.js";
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
export declare function resolveFunctionPresets(schema: SettingsSchema): Promise<ResolvedPresets>;
