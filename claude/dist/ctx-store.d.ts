/**
 * Captured host context, stashed at pane-open so resolvers that run later
 * (the model type-def's preset resolver) can read the host's models list
 * without it being threaded through every call. Captured once per open;
 * tolerant of hosts that expose only a subset.
 */
import type { ModelLike } from "./model-presets.js";
import type { PresetPair } from "./schema.js";
interface CapturedCtx {
    models?: readonly ModelLike[];
    /** Enabled-models patterns the host read from its settings (null = unscoped). */
    enabledModelPatterns?: string[] | null;
    /** Host-declared static pairs offered verbatim before any captured models
     *  (platforms with no model-list API can still document their aliases). */
    staticModelPairs?: PresetPair[];
    cwd?: string;
}
/**
 * Stash the host context (models + cwd) for later resolver use.
 * Tolerates a context lacking either field — a host that does not expose
 * models stores `undefined`, and the model resolver degrades to a
 * Default-only list.
 */
export declare function captureCtx(ctx: {
    models?: readonly ModelLike[];
    enabledModelPatterns?: string[] | null;
    staticModelPairs?: PresetPair[];
    cwd?: string;
}): void;
/**
 * Read the stash captured at pane-open. Resolvers (the model type-def) call
 * this to reach the host's models without it being threaded through every
 * call.
 */
export declare function getCapturedCtx(): CapturedCtx;
export {};
