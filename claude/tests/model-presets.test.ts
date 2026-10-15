// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

// Model presets port: pure label/value/split helpers stay verbatim; the
// registry read is an injected models list; the enabled-models glob uses a
// small in-package matcher (no dependency).

import { describe, expect, test } from "vitest";
import { captureCtx } from "../src/ctx-store.js";
import { globMatch, isEnabled, modelLabel, resolveModelPresets, splitModelId } from "../src/model-presets.js";

const MODELS = [
  { id: "claude-sonnet-4", provider: "anthropic" },
  { id: "gemini-2.0-flash", provider: "google" },
  { id: "gpt-5-mini", provider: "openai" },
];

describe("model value helpers (pi-verbatim)", () => {
  test("label is `<id> [<provider>]`", () => {
    expect(modelLabel(MODELS[0])).toBe("claude-sonnet-4 [anthropic]");
  });

  test("splitModelId splits on the FIRST slash; no slash is null", () => {
    expect(splitModelId("anthropic/claude-sonnet-4")).toEqual({ provider: "anthropic", id: "claude-sonnet-4" });
    expect(splitModelId("proxy/a/b")).toEqual({ provider: "proxy", id: "a/b" });
    expect(splitModelId("nodelimiter")).toBeNull();
  });
});

describe("globMatch — the minimatch subset", () => {
  test("a literal pattern matches itself, case-insensitively", () => {
    expect(globMatch("Anthropic/Claude-Sonnet-4", "anthropic/claude-sonnet-4")).toBe(true);
    expect(globMatch("anthropic/claude-haiku", "anthropic/claude-sonnet-4")).toBe(false);
  });

  test("a star matches any run within one segment and across the whole id", () => {
    expect(globMatch("anthropic/claude-sonnet-4", "anthropic/*")).toBe(true);
    expect(globMatch("google/gemini-2.0-flash", "anthropic/*")).toBe(false);
    expect(globMatch("claude-sonnet-4", "claude*")).toBe(true);
    expect(globMatch("anything/at/all", "*")).toBe(true);
  });

  test("a question mark matches exactly one character", () => {
    expect(globMatch("gpt-5-mini", "gpt-?-mini")).toBe(true);
    expect(globMatch("gpt-55-mini", "gpt-?-mini")).toBe(false);
  });

  test("special regex characters in the pattern are literals", () => {
    expect(globMatch("a.b+c(d)", "a.b+c(d)")).toBe(true);
    expect(globMatch("axbyczd", "a.b+c(d)")).toBe(false);
  });
});

describe("isEnabled — pattern scoping over full id or bare id", () => {
  test("full-id and bare-id patterns both match", () => {
    expect(isEnabled(MODELS[0], ["anthropic/*"])).toBe(true);
    expect(isEnabled(MODELS[0], ["claude-*"])).toBe(true);
    expect(isEnabled(MODELS[1], ["anthropic/*", "claude-*"])).toBe(false);
  });
});

describe("resolveModelPresets — the injected-registry resolver", () => {
  test("no captured models degrades to Default-only", async () => {
    captureCtx({});
    const pairs = await resolveModelPresets();
    expect(pairs).toEqual([["Default", null]]);
  });

  test("captured models map to label/value pairs with Default first", async () => {
    captureCtx({ models: MODELS });
    const pairs = await resolveModelPresets();
    expect(pairs).toEqual([
      ["Default", null],
      ["claude-sonnet-4 [anthropic]", "anthropic/claude-sonnet-4"],
      ["gemini-2.0-flash [google]", "google/gemini-2.0-flash"],
      ["gpt-5-mini [openai]", "openai/gpt-5-mini"],
    ]);
  });

  test("enabled patterns scope the list; matching nothing falls back to all", async () => {
    captureCtx({ models: MODELS, enabledModelPatterns: ["anthropic/*"] });
    const scoped = await resolveModelPresets();
    expect(scoped).toEqual([
      ["Default", null],
      ["claude-sonnet-4 [anthropic]", "anthropic/claude-sonnet-4"],
    ]);
    captureCtx({ models: MODELS, enabledModelPatterns: ["nomatch/*"] });
    const none = await resolveModelPresets();
    expect(none).toHaveLength(4);
    captureCtx({ models: MODELS, enabledModelPatterns: null });
    expect(await resolveModelPresets()).toHaveLength(4);
  });
});
