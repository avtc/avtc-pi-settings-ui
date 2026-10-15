// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Generic settings persistence over an injected fs adapter.
 *
 * Layered JSON file read/write. Uses the schema for field names (no
 * hardcoded per-field logic). Writes are whole-file replaces: the surface
 * this package targets offers no rename, so the temp-file-and-rename
 * atomicity of the terminal variant is traded for a plain write of a small
 * file — accepted because one process owns each file.
 *
 * KNOWN GAP — atomic write: the terminal variant writes temp-then-rename
 * (readers never see a half-written file); the target surface offers no
 * rename primitive and its writes are documented non-atomic, so this file
 * replaces in place. Tracked here (code, not working docs) precisely so it
 * can be closed later: if a future Claude release surfaces an atomic-write
 * or rename primitive, restore temp-then-rename in `writeJsonFile` and drop
 * this note.
 */

import type { FsAdapter } from "./fs-adapter.js";
import { normalizeFromSchema } from "./normalization.js";
import type { SettingsSchema } from "./schema.js";

/**
 * Standard settings file paths for a consumer named `name` — the Claude
 * layout (one layout for every consumer, no hand-rolled path logic):
 *   global:  <globalDir | home/.claude>/<name>-settings.json
 *   project: <cwd>/.claude/<name>-settings.json
 *
 * `home` is injected by the host (no os.homedir here); the default layout
 * nests under `<home>/.claude`.
 */
export function settingsFilePaths(
  name: string,
): Pick<SettingsSchema, "globalPath" | "projectPath"> & { globalPath: (globalDir?: string, home?: string) => string } {
  const filename = `${name}-settings.json`;
  return {
    globalPath: (globalDir?: string, home?: string): string => `${globalDir ?? `${home ?? ""}/.claude`}/${filename}`,
    projectPath: (cwd: string): string => `${cwd}/.claude/${filename}`,
  };
}

/** Read and parse a JSON file over the adapter, returning null on any error or absence. */
export async function readJsonFile(fs: FsAdapter, filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.read(filePath);
    if (raw === null) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Write JSON to a file (whole-file replace, 2-space indent + trailing newline). */
export async function writeJsonFile(fs: FsAdapter, filePath: string, data: unknown): Promise<void> {
  await fs.write(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Load settings from layered files (global + project override).
 * Uses the schema for field names — no per-field switch needed.
 *
 * Identical layering to the terminal variant: defaults, then every normalized
 * global value, then only the keys explicitly present in the project file.
 */
export async function loadSettingsFromFiles(
  fs: FsAdapter,
  cwd: string,
  schema: SettingsSchema,
  defaults: Record<string, unknown>,
  globalDir: string | undefined,
): Promise<Record<string, unknown>> {
  const globalPath = schema.globalPath(globalDir);
  const projectPath = schema.projectPath(cwd);

  const globalRaw = await readJsonFile(fs, globalPath);
  const projectRaw = await readJsonFile(fs, projectPath);

  // Start with defaults, layer global, then project
  let settings: Record<string, unknown> = { ...defaults };

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
