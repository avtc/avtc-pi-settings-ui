// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { settingsFilePaths } from "../src/persistence.js";

describe("settingsFilePaths", () => {
  test("global default lands under ~/.pi/agent/<name>-settings.json", () => {
    const { globalPath } = settingsFilePaths("todo");
    expect(globalPath(undefined)).toBe(join(join(homedir(), ".pi"), "agent", "todo-settings.json"));
  });

  test("honors an explicit globalDir override", () => {
    const { globalPath } = settingsFilePaths("subagent");
    expect(globalPath("/custom/root")).toBe(join("/custom/root", "agent", "subagent-settings.json"));
  });

  test("project path lands under <cwd>/.pi/<name>-settings.json", () => {
    const { projectPath } = settingsFilePaths("parallel-work-guardrail");
    expect(projectPath("/proj")).toBe(join("/proj", ".pi", "parallel-work-guardrail-settings.json"));
  });

  test("uses the full extension name (not a short form)", () => {
    // Regression: guardrail previously used the short 'guardrail-settings.json'.
    const { projectPath } = settingsFilePaths("parallel-work-guardrail");
    const p = projectPath("/p");
    expect(p.endsWith("parallel-work-guardrail-settings.json")).toBe(true);
    // The final filename segment must be the full name, not the short 'guardrail-settings.json'.
    const basename = p.split(/[/\\]/).pop();
    expect(basename).toBe("parallel-work-guardrail-settings.json");
  });
});
