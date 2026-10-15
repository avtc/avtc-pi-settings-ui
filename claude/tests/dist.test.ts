// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Guards the SHIPPED artifact. Consumers import this package from inside a
 * Claude mod's hooks closure, where the loader refuses every bare package
 * specifier and every node: builtin, closure-wide. These tests fail the
 * build if dist ever grows such an import (e.g. a dependency sneaking into
 * a helper) or stops importing cleanly under plain Node ESM.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));

function distFiles(): string[] {
  return readdirSync(distDir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".js") || f.endsWith(".d.ts"));
}

const BARE_OR_NODE = /^\s*import\s+["'](?!\.+\/)(?![a-z]+:)/m;

describe("the shipped dist stays closure-safe", () => {
  test("built files exist", () => {
    const files = distFiles();
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain("index.js");
  });

  test("no bare specifiers and no node: builtins anywhere in dist", () => {
    const offenders: string[] = [];
    for (const file of distFiles()) {
      const text = readFileSync(`${distDir}/${file}`, "utf8");
      if (BARE_OR_NODE.test(text) || text.includes('"node:') || text.includes("'node:")) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the entry imports cleanly under plain Node ESM", async () => {
    const mod = await import("../dist/index.js");
    expect(typeof mod.createSettingsExtension).toBe("function");
    expect(typeof mod.createPaneController).toBe("function");
    expect(typeof mod.buildPaneTree).toBe("function");
    expect(typeof mod.settingsFilePaths).toBe("function");
  });
});
