// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>
let captured = {};
/**
 * Stash the host context (models + cwd) for later resolver use.
 * Tolerates a context lacking either field — a host that does not expose
 * models stores `undefined`, and the model resolver degrades to a
 * Default-only list.
 */
export function captureCtx(ctx) {
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
export function getCapturedCtx() {
    return captured;
}
