// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Tests for captureCtx — stashes command context (modelRegistry + cwd) at modal-open so
 * the model type-def's preset resolver can read it later via getCapturedCtx. Here we cover the
 * capture-side contract: tolerate a context that lacks modelRegistry without throwing.
 */

import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { captureCtx, getCapturedCtx } from "../src/ctx-store.js";

describe("captureCtx / getCapturedCtx", () => {
  it("stashes modelRegistry + cwd and reads them back", () => {
    const fakeRegistry = { refresh: () => {}, getAvailable: () => [], getError: () => "" } as unknown as ModelRegistry;
    captureCtx({ modelRegistry: fakeRegistry, cwd: "/cwd" });

    const stash = getCapturedCtx();
    expect(stash.modelRegistry).toBe(fakeRegistry);
    expect(stash.cwd).toBe("/cwd");
  });

  it("tolerates a context that lacks modelRegistry (graceful degradation)", () => {
    // A host that does not expose modelRegistry must not crash capture — the model resolver
    // later degrades to a Default-only list when the registry is absent.
    expect(() => captureCtx({ cwd: "/cwd" })).not.toThrow();
    expect(getCapturedCtx().modelRegistry).toBeUndefined();
    expect(getCapturedCtx().cwd).toBe("/cwd");
  });

  it("tolerates an empty context", () => {
    expect(() => captureCtx({})).not.toThrow();
    expect(getCapturedCtx().modelRegistry).toBeUndefined();
  });

  it("overwrites the previous stash on re-capture (singleton per open)", () => {
    const first = { refresh: () => {}, getAvailable: () => [], getError: () => "" } as unknown as ModelRegistry;
    captureCtx({ modelRegistry: first, cwd: "/one" });
    captureCtx({ cwd: "/two" });

    const stash = getCapturedCtx();
    expect(stash.modelRegistry).toBeUndefined();
    expect(stash.cwd).toBe("/two");
  });
});
