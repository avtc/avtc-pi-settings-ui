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
export declare function settingsFilePaths(name: string): Pick<SettingsSchema, "globalPath" | "projectPath"> & {
    globalPath: (globalDir?: string, home?: string) => string;
};
/** Read and parse a JSON file over the adapter, returning null on any error or absence. */
export declare function readJsonFile(fs: FsAdapter, filePath: string): Promise<Record<string, unknown> | null>;
/** Write JSON to a file (whole-file replace, 2-space indent + trailing newline). */
export declare function writeJsonFile(fs: FsAdapter, filePath: string, data: unknown): Promise<void>;
/**
 * Load settings from layered files (global + project override).
 * Uses the schema for field names — no per-field switch needed.
 *
 * Identical layering to the terminal variant: defaults, then every normalized
 * global value, then only the keys explicitly present in the project file.
 */
export declare function loadSettingsFromFiles(fs: FsAdapter, cwd: string, schema: SettingsSchema, defaults: Record<string, unknown>, globalDir: string | undefined): Promise<Record<string, unknown>>;
