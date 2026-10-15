// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

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

let captured: CapturedCtx = {};

/**
 * Stash the host context (models + cwd) for later resolver use.
 * Tolerates a context lacking either field — a host that does not expose
 * models stores `undefined`, and the model resolver degrades to a
 * Default-only list.
 */
export function captureCtx(ctx: {
  models?: readonly ModelLike[];
  enabledModelPatterns?: string[] | null;
  staticModelPairs?: PresetPair[];
  cwd?: string;
}): void {
  captured = {
    models: ctx.models,
    enabledModelPatterns: ctx.enabledModelPatterns,
    staticModelPairs: ctx.staticModelPairs,
    cwd: ctx.cwd,
  };
}

/**
 * Read the stash captured at pane-open. Resolvers (the model type-def) call
 * this to reach the host's models without it being threaded through every
 * call.
 */
export function getCapturedCtx(): CapturedCtx {
  return captured;
}
