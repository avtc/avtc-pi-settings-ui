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

/** A fake registry exposing only the surface resolveModelPresets touches. */
function fakeRegistry(available: Array<{ id: string; provider: string }>): {
  getAvailable: () => Array<{ id: string; provider: string }>;
  getError: () => string | undefined;
  refresh: () => void;
} {
  return {
    getAvailable: () => available,
    getError: () => undefined,
    refresh: vi.fn(),
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

  it("returns only ['Default', null] when no modelRegistry was captured", () => {
    captureCtx({});
    expect(resolveModelPresets()).toEqual([["Default", null]]);
  });

  it("returns ['Default', null] + every available model when enabledModels is unset", () => {
    const mr = fakeRegistry([model("claude-3-5-sonnet", "anthropic"), model("gpt-4o", "openai")]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    expect(resolveModelPresets()).toEqual([
      ["Default", null],
      ["claude-3-5-sonnet [anthropic]", "anthropic/claude-3-5-sonnet"],
      ["gpt-4o [openai]", "openai/gpt-4o"],
    ]);
    expect(mr.refresh).toHaveBeenCalled();
  });

  it("returns only ['Default', null] when the registry has no available models", () => {
    // A host with no auth-configured models (empty getAvailable) still opens the picker with the
    // Default entry — never an empty list.
    const mr = fakeRegistry([]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    expect(resolveModelPresets()).toEqual([["Default", null]]);
  });

  it("scopes by a glob pattern (['anthropic/*'] → only anthropic models)", () => {
    setEnabledModels(["anthropic/*"]);
    const mr = fakeRegistry([model("claude-3-5-sonnet", "anthropic"), model("gpt-4o", "openai")]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    expect(resolveModelPresets()).toEqual([
      ["Default", null],
      ["claude-3-5-sonnet [anthropic]", "anthropic/claude-3-5-sonnet"],
    ]);
  });

  it("scopes by an exact full-id pattern (['anthropic/claude-3-5-sonnet'])", () => {
    setEnabledModels(["anthropic/claude-3-5-sonnet"]);
    const mr = fakeRegistry([model("claude-3-5-sonnet", "anthropic"), model("claude-3-haiku", "anthropic")]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    expect(resolveModelPresets()).toEqual([
      ["Default", null],
      ["claude-3-5-sonnet [anthropic]", "anthropic/claude-3-5-sonnet"],
    ]);
  });

  it("matches a bare-id pattern against the model id", () => {
    setEnabledModels(["gpt-4o"]);
    const mr = fakeRegistry([model("gpt-4o", "openai"), model("o3", "openai")]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    expect(resolveModelPresets()).toEqual([
      ["Default", null],
      ["gpt-4o [openai]", "openai/gpt-4o"],
    ]);
  });

  it("matches case-insensitively (['ANTHROPIC/*'])", () => {
    setEnabledModels(["ANTHROPIC/*"]);
    const mr = fakeRegistry([model("claude-3-5-sonnet", "anthropic"), model("gpt-4o", "openai")]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    expect(resolveModelPresets()).toEqual([
      ["Default", null],
      ["claude-3-5-sonnet [anthropic]", "anthropic/claude-3-5-sonnet"],
    ]);
  });

  it("falls back to all available models when enabledModels matches nothing", () => {
    // A stale/typo pattern must not empty the picker — fall back to every available model.
    setEnabledModels(["nonexistent-provider/*"]);
    const mr = fakeRegistry([model("claude-3-5-sonnet", "anthropic"), model("gpt-4o", "openai")]);
    captureCtx({ modelRegistry: mr as unknown as ModelRegistry });

    expect(resolveModelPresets()).toEqual([
      ["Default", null],
      ["claude-3-5-sonnet [anthropic]", "anthropic/claude-3-5-sonnet"],
      ["gpt-4o [openai]", "openai/gpt-4o"],
    ]);
  });
});
