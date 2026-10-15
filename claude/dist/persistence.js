// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>
import { normalizeFromSchema } from "./normalization.js";
/**
 * Standard settings file paths for a consumer named `name` — the Claude
 * layout (one layout for every consumer, no hand-rolled path logic):
 *   global:  <globalDir | home/.claude>/<name>-settings.json
 *   project: <cwd>/.claude/<name>-settings.json
 *
 * `home` is injected by the host (no os.homedir here); the default layout
 * nests under `<home>/.claude`.
 */
export function settingsFilePaths(name) {
    const filename = `${name}-settings.json`;
    return {
        globalPath: (globalDir, home) => `${globalDir ?? `${home ?? ""}/.claude`}/${filename}`,
        projectPath: (cwd) => `${cwd}/.claude/${filename}`,
    };
}
/** Read and parse a JSON file over the adapter, returning null on any error or absence. */
export async function readJsonFile(fs, filePath) {
    try {
        const raw = await fs.read(filePath);
        if (raw === null)
            return null;
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** Write JSON to a file (whole-file replace, 2-space indent + trailing newline). */
export async function writeJsonFile(fs, filePath, data) {
    await fs.write(filePath, `${JSON.stringify(data, null, 2)}\n`);
}
/**
 * Load settings from layered files (global + project override).
 * Uses the schema for field names — no per-field switch needed.
 *
 * Identical layering to the terminal variant: defaults, then every normalized
 * global value, then only the keys explicitly present in the project file.
 */
export async function loadSettingsFromFiles(fs, cwd, schema, defaults, globalDir) {
    const globalPath = schema.globalPath(globalDir);
    const projectPath = schema.projectPath(cwd);
    const globalRaw = await readJsonFile(fs, globalPath);
    const projectRaw = await readJsonFile(fs, projectPath);
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
