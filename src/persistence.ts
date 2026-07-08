// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Generic settings persistence.
 *
 * Layered JSON file read/write with atomic writes.
 * Uses schema for field names (no hardcoded per-field logic).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeFromSchema } from "./normalization.js";
import type { SettingsSchema } from "./schema.js";

/**
 * Standard settings file paths for an extension named `name`.
 *
 * Returns the `globalPath` / `projectPath` pair every settings-ui consumer uses,
 * so all extensions follow ONE layout (no per-consumer hand-rolled path logic):
 *   global:  <globalDir | ~/.pi>/agent/<name>-settings.json
 *   project: <cwd>/.pi/<name>-settings.json
 *
 * Uses `os.homedir()` + `path.join` (cross-platform correct); consumers must NOT
 * hand-roll these with env-var string concatenation.
 */
export function settingsFilePaths(name: string): Pick<SettingsSchema, "globalPath" | "projectPath"> {
  const filename = `${name}-settings.json`;
  return {
    globalPath: (globalDir?: string): string => join(globalDir ?? join(homedir(), ".pi"), "agent", filename),
    projectPath: (cwd: string): string => join(cwd, ".pi", filename),
  };
}

/** Read and parse a JSON file, returning null on any error. */
export function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Atomically write JSON to a file via temp file + rename. */
export function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  renameSync(tmp, filePath);
}

/**
 * Load settings from layered files (global + project override).
 * Uses schema for field names — no per-field switch needed.
 */
export function loadSettingsFromFiles(
  cwd: string,
  schema: SettingsSchema,
  defaults: Record<string, unknown>,
  globalDir: string | undefined,
): Record<string, unknown> {
  const globalPath = schema.globalPath(globalDir);
  const projectPath = schema.projectPath(cwd);

  const globalRaw = readJsonFile(globalPath);
  const projectRaw = readJsonFile(projectPath);

  // Start with defaults, layer global, then project
  let settings = { ...defaults };

  if (globalRaw) {
    const normalized = normalizeFromSchema(globalRaw, schema);
    // Merge all normalized global values
    settings = { ...settings, ...normalized };
  }

  if (projectRaw) {
    const normalized = normalizeFromSchema(projectRaw, schema);
    // Only override keys that are explicitly present in the project file
    for (const setting of schema.settings) {
      const present = setting.id in projectRaw || setting.aliases?.some((a) => a in projectRaw);
      if (present) {
        settings[setting.id] = normalized[setting.id];
      }
    }
  }

  return settings;
}

/**
 * Save settings to global file.
 */
export function saveGlobalSettings(
  settings: Record<string, unknown>,
  schema: SettingsSchema,
  globalDir: string | undefined,
): void {
  const filePath = schema.globalPath(globalDir);
  atomicWriteJson(filePath, settings);
}

/**
 * Save settings to project file.
 */
export function saveProjectSettings(settings: Record<string, unknown>, cwd: string, schema: SettingsSchema): void {
  const filePath = schema.projectPath(cwd);
  atomicWriteJson(filePath, settings);
}
