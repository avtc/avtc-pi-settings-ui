// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Tests for the model presets resolver — reads the captured model registry, scopes by the
 * host's enabled-models patterns, and produces the [label, value] preset pairs for a
 * `model` setting (provider/id values, a Default null entry prepended).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Control what enabledModels the resolver sees, independent of the real ~/.pi/agent/settings.json.
const readJsonFile = vi.fn<() => Record<string, unknown> | null>(() => null);
vi.mock("../src/persistence.js", () => ({ readJsonFile: () => readJsonFile() }));

import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { captureCtx } from "../src/ctx-store.js";
import { modelLabel, resolveModelPresets } from "../src/model-presets.js";

/** A minimal model shape — modelLabel reads only id + provider. */
function model(id: string, provider: string): { id: string; provider: string } {
  return { id, provider };
}

/** A fake registry exposing only the surface resolveModelPresets touches.
 *  `refresh` mirrors the pi 0.80.8+ async contract: it returns a Promise that resolves
 *  once "models.json is reloaded" (here, synchronously). Tracking the mock lets tests assert
 *  refresh was awaited before getAvailable ran. */
function fakeRegistry(available: Array<{ id: string; provider: string }>): {
  getAvailable: () => Array<{ id: string; provider: string }>;
  getError: () => string | undefined;
  refresh: () => Promise<void>;
} {
  return {
    getAvailable: () => available,
    getError: () => undefined,
    refresh: vi.fn().mockResolvedValue(undefined),
  };
}

/** Set the host settings file's enabledModels (null = no enabledModels key / absent file). */
function setEnabledModels(patterns: string[] | null): void {
  readJsonFile.mockReturnValue(patterns === null ? null : { enabledModels: patterns });
}

describe("modelLabel", () => {
  it("formats a model as 'id [provider]'", () => {
    expect(modelLabel(model("claude-3-5-sonnet", "anthropic"))).toBe("claude-3-5-sonnet [anthropic]");
  });
});

describe("resolveModelPresets", () => {
  // The captured ctx is a module singleton — reset it between tests so one test's registry does
  // not leak into another.
  beforeEach(() => {
    captureCtx({});
    readJsonFile.mockReset();
    setEnabledModels(null);
  });

  it("returns only ['Default', null] when no modelRegistry was captured", async () => {
    captureCtx({});
    await expect(resolveModelPresets()).resolves.toEqual([["Default", null]]);
  });

  it("returns ['Default', null] + every available model when enabledModels is unset", async () => {
    const mr = fakeRegistry([model("claude-3-5-sonnet", "anthropic"), model("gpt-4o", "openai")]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    await expect(resolveModelPresets()).resolves.toEqual([
      ["Default", null],
      ["claude-3-5-sonnet [anthropic]", "anthropic/claude-3-5-sonnet"],
      ["gpt-4o [openai]", "openai/gpt-4o"],
    ]);
    expect(mr.refresh).toHaveBeenCalled();
  });

  it("awaits refresh() before reading getAvailable (no stale read on async refresh)", async () => {
    // The pi 0.80.8+ contract: refresh() reloads models.json async. getAvailable must run AFTER
    // refresh resolves, or it reads the stale list. Here refresh resolves on a later microtask
    // and only THEN does getAvailable see the "fresh" list — proving the await ordering.
    let refreshed = false;
    const mr = {
      refresh: () =>
        new Promise<void>((resolve) => {
          // Defer resolution so a non-awaited refresh would read `refreshed === false`.
          setTimeout(() => {
            refreshed = true;
            resolve();
          }, 0);
        }),
      getAvailable: () => (refreshed ? [model("fresh-model", "openai")] : []),
      getError: () => undefined,
    };
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    await expect(resolveModelPresets()).resolves.toEqual([
      ["Default", null],
      ["fresh-model [openai]", "openai/fresh-model"],
    ]);
  });

  it("returns only ['Default', null] when the registry has no available models", async () => {
    // A host with no auth-configured models (empty getAvailable) still opens the picker with the
    // Default entry — never an empty list.
    const mr = fakeRegistry([]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    await expect(resolveModelPresets()).resolves.toEqual([["Default", null]]);
  });

  it("scopes by a glob pattern (['anthropic/*'] → only anthropic models)", async () => {
    setEnabledModels(["anthropic/*"]);
    const mr = fakeRegistry([model("claude-3-5-sonnet", "anthropic"), model("gpt-4o", "openai")]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    await expect(resolveModelPresets()).resolves.toEqual([
      ["Default", null],
      ["claude-3-5-sonnet [anthropic]", "anthropic/claude-3-5-sonnet"],
    ]);
  });

  it("scopes by an exact full-id pattern (['anthropic/claude-3-5-sonnet'])", async () => {
    setEnabledModels(["anthropic/claude-3-5-sonnet"]);
    const mr = fakeRegistry([model("claude-3-5-sonnet", "anthropic"), model("claude-3-haiku", "anthropic")]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    await expect(resolveModelPresets()).resolves.toEqual([
      ["Default", null],
      ["claude-3-5-sonnet [anthropic]", "anthropic/claude-3-5-sonnet"],
    ]);
  });

  it("matches a bare-id pattern against the model id", async () => {
    setEnabledModels(["gpt-4o"]);
    const mr = fakeRegistry([model("gpt-4o", "openai"), model("o3", "openai")]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    await expect(resolveModelPresets()).resolves.toEqual([
      ["Default", null],
      ["gpt-4o [openai]", "openai/gpt-4o"],
    ]);
  });

  it("matches case-insensitively (['ANTHROPIC/*'])", async () => {
    setEnabledModels(["ANTHROPIC/*"]);
    const mr = fakeRegistry([model("claude-3-5-sonnet", "anthropic"), model("gpt-4o", "openai")]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    await expect(resolveModelPresets()).resolves.toEqual([
      ["Default", null],
      ["claude-3-5-sonnet [anthropic]", "anthropic/claude-3-5-sonnet"],
    ]);
  });

  it("falls back to all available models when enabledModels matches nothing", async () => {
    // A stale/typo pattern must not empty the picker — fall back to every available model.
    setEnabledModels(["nonexistent-provider/*"]);
    const mr = fakeRegistry([model("claude-3-5-sonnet", "anthropic"), model("gpt-4o", "openai")]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    await expect(resolveModelPresets()).resolves.toEqual([
      ["Default", null],
      ["claude-3-5-sonnet [anthropic]", "anthropic/claude-3-5-sonnet"],
      ["gpt-4o [openai]", "openai/gpt-4o"],
    ]);
  });
});
