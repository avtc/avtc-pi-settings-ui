// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Captured command context, stashed at modal-open so resolvers that run later (the model
 * type-def's preset resolver) can read the host's model registry without it being threaded
 * through every call. Captured once per open; tolerant of hosts that expose only a subset.
 */

import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

interface CapturedCtx {
  modelRegistry?: ModelRegistry;
  cwd?: string;
}

let captured: CapturedCtx = {};

/**
 * Stash the command context (modelRegistry + cwd) for later resolver use.
 * Tolerates a context lacking either field — a host that does not expose modelRegistry
 * stores `undefined`, and the model resolver degrades to a Default-only list.
 */
export function captureCtx(ctx: { modelRegistry?: ModelRegistry; cwd?: string }): void {
  captured = { modelRegistry: ctx.modelRegistry, cwd: ctx.cwd };
}

/**
 * Read the stash captured at modal-open. Resolvers (the model type-def) call this to reach
 * the host's model registry without it being threaded through every call.
 */
export function getCapturedCtx(): CapturedCtx {
  return captured;
}
