/**
 * Factory for creating settings extensions over injected seams.
 *
 * Given a SettingsSchema + options, provides getSettings / updateSetting /
 * load / persist. This variant runs where files and environment are async
 * surfaces and no `process` exists, so every outward touch goes through the
 * injected `fs` adapter and `env` store.
 *
 * One persistence mode — BUFFER (the terminal variant's stateless single-file
 * mode is not ported): an in-memory buffer is the read target; the env var is
 * serialized iff `session` is included (for subagent propagation + reload
 * survival). File writes are explicit, whole-file, and async (`persist*`).
 */
import type { FsAdapter } from "./fs-adapter.js";
import { type SettingsSchema, type StorageLevel } from "./schema.js";
/** The environment seam: read and write one variable (the host injects its surface).
 *  Reads may be promise-shaped — hosts such as this platform's `$.env.get` are async,
 *  so `load()` awaits the value; sync adapters keep working unchanged. */
export interface EnvStore {
    get(name: string): string | undefined | Promise<string | undefined>;
    set(name: string, value: string): void;
}
/**
 * Create a settings extension from a schema.
 *
 * The host wires `load` at startup (and on every session start) and reads via
 * `getSettings`; the pane persists explicitly (`persistToProject` /
 * `persistToGlobal`), so consumers never wire file IO by hand.
 */
export declare function createSettingsExtension<S extends object = Record<string, unknown>>(schema: SettingsSchema, options: {
    fs: FsAdapter;
    env: EnvStore;
    storageLevels?: StorageLevel[];
    clampFn?: (result: Record<string, unknown>) => void;
    envVar?: string;
    onLoad?: () => void;
}): {
    getSettings: () => S;
    updateSetting: (key: string, value: unknown, opts?: {
        level?: StorageLevel;
    }) => void;
    load: (cwdArg: string | undefined, globalDirArg: string | undefined) => Promise<void>;
    persistToGlobal: () => Promise<void>;
    persistToProject: (cwdArg?: string) => Promise<void>;
    computeDefaults: () => S;
    schema: SettingsSchema;
    storageLevels: StorageLevel[];
};
