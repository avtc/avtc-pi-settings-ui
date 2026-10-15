import type { PresetPair } from "./schema.js";
/** The model fields `modelLabel` reads. Structural so any model-like object works. */
export interface ModelLike {
    readonly id: string;
    readonly provider: string;
}
/**
 * Format a model as `"<id> [<provider>]"` — the same shape the host's own
 * model selector renders (the raw provider id is used, not a display name).
 */
export declare function modelLabel(model: ModelLike): string;
/** Split a serialized model value `"<provider>/<id>"` on the FIRST slash, so an id that itself
 *  contains a slash still resolves by its leading provider/id segments. Returns `null` when the
 *  value has no slash (not a `provider/id` form — e.g. the null/"Default" entry). */
export declare function splitModelId(value: string): {
    provider: string;
    id: string;
} | null;
/**
 * Glob match over the minimatch subset patterns use: `*` (any run), `?`
 * (exactly one), everything else literal; case-insensitive. No brace
 * expansion, extglobs or `**` segmentation — enabled-models patterns are
 * simple (`anthropic/*`, `claude-*`).
 */
export declare function globMatch(text: string, pattern: string): boolean;
/**
 * Keep a model iff any enabled-models pattern matches it — either its full
 * `provider/id` or its bare `id`. A pattern without glob metacharacters
 * matches as a literal, so a full id like `anthropic/claude-3-5` matches
 * exactly the same way a glob like `anthropic/*` does.
 */
export declare function isEnabled(model: ModelLike, patterns: readonly string[]): boolean;
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
export declare function resolveModelPresets(): Promise<PresetPair[]>;
