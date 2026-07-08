// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Factory for creating settings extensions.
 *
 * Given a SettingsSchema + options, provides getSettings / updateSetting / loadSettingsIntoMemory.
 * Two persistence modes, selected by `storageLevels`:
 *  - STATELESS (a single file level — `["global"]` or `["project"]`): `getSettings` reads the file
 *    fresh on every call (cross-instance immediate), `updateSetting` does an immediate
 *    read-modify-write of that file, and the env var is never read or written.
 *  - BUFFER (everything else — the default session+project+global, or any combination involving
 *    session or multiple files): an in-memory buffer is the read target; the env var is serialized
 *    iff `session` is included (for subagent propagation + reload survival).
 */

import {
  clampSettings,
  isInvalidResult,
  normalizeFromSchema,
  resolveSettingValue,
  validateSchema,
} from "./normalization.js";
import {
  saveGlobalSettings as _saveGlobalSettings,
  saveProjectSettings as _saveProjectSettings,
  atomicWriteJson,
  loadSettingsFromFiles,
  readJsonFile,
} from "./persistence.js";
import { normalizeStorageLevels, type SettingSchema, type SettingsSchema, type StorageLevel } from "./schema.js";

/** Resolve a raw value through the gate, returning the default for the `undefined` reset sentinel. */
function resolveUpdateValue(
  raw: unknown,
  setting: SettingSchema,
): { value: unknown; invalid: false } | { invalid: true } {
  if (raw === undefined) return { value: setting.defaultValue, invalid: false };
  const resolved = resolveSettingValue({ [setting.id]: raw }, setting);
  if (isInvalidResult(resolved)) return { invalid: true };
  return { value: resolved, invalid: false };
}

/**
 * Create a settings extension from a schema.
 *
 * The host extension registers the command via `registerSettingsCommand` (which auto-calls
 * `loadSettingsIntoMemory` at registration + on `session_start`), so consumers no longer wire
 * startup loading by hand.
 */
export function createSettingsExtension<S extends object = Record<string, unknown>>(
  schema: SettingsSchema,
  options: {
    storageLevels?: StorageLevel[];
    clampFn?: (result: Record<string, unknown>) => void;
    envVar?: string;
    onLoad?: () => void;
  } = {},
) {
  // Validate the schema up front (fail-fast): preset strings parse, every setting is in a tab,
  // every tab id resolves, no duplicate/orphan ids. Also eagerly populates the static-presets
  // cache so runtime resolution never re-throws.
  validateSchema(schema);

  const clampFn = options.clampFn;
  const envVar = options.envVar;
  const onLoad = options.onLoad;
  const storageLevels = normalizeStorageLevels(options.storageLevels);
  const sessionIncluded = storageLevels.includes("session");
  const singleFileLevel =
    storageLevels.length === 1 && (storageLevels[0] === "global" || storageLevels[0] === "project");
  const singleFileKind: "global" | "project" | null = singleFileLevel
    ? (storageLevels[0] as "global" | "project")
    : null;

  // Buffer-mode state (unused in stateless mode — every read/write hits the file directly).
  let settings: Record<string, unknown> = {};
  let settingsLoaded = false;
  // cwd/globalDir learned via loadSettingsIntoMemory (used by stateless reads + project writes).
  // Default to process.cwd() so a stateless getSettings() works before any load call.
  let cwd = process.cwd();
  let globalDir: string | undefined;

  function computeDefaults(): S {
    const defaults: Record<string, unknown> = {};
    for (const setting of schema.settings) {
      defaults[setting.id] = setting.defaultValue;
    }
    return defaults as S;
  }

  /** The single file path for a stateless handle (global or project, per `singleFileKind`). */
  function singleFilePath(): string {
    return singleFileKind === "global" ? schema.globalPath(globalDir) : schema.projectPath(cwd);
  }

  function getSettings(): S {
    if (singleFileLevel) {
      // Stateless: read the file fresh every call (cross-instance immediate), normalize + clamp.
      const raw = readJsonFile(singleFilePath()) ?? {};
      const normalized = normalizeFromSchema(raw, schema);
      clampSettings(normalized, clampFn);
      return normalized as S;
    }
    return settings as S;
  }

  /** Apply a resolved value to the buffer + clamp + serialize the env var (buffer mode only). */
  function applyToBuffer(canonicalKey: string, resolvedValue: unknown): void {
    settings[canonicalKey] = resolvedValue;
    settingsLoaded = true;
    clampSettings(settings, clampFn);
    if (envVar && sessionIncluded) {
      process.env[envVar] = JSON.stringify(settings);
    }
  }

  /**
   * Read-modify-write a single key into a file: read the fresh file, set the key, normalize +
   * clamp the whole record, full-rewrite atomically. Used by both stateless no-level writes and
   * explicit project/global surgical writes.
   */
  function writeKeyToFile(path: string, canonicalKey: string, resolvedValue: unknown): void {
    const existing = readJsonFile(path) ?? {};
    existing[canonicalKey] = resolvedValue;
    const normalized = normalizeFromSchema(existing, schema);
    clampSettings(normalized, clampFn);
    atomicWriteJson(path, normalized);
  }

  function updateSetting(
    key: string,
    value: unknown,
    opts: {
      level?: StorageLevel;
    } = {},
  ): void {
    const settingSchema = schema.settings.find((s) => s.id === key || s.aliases?.includes(key));
    if (!settingSchema) return;
    const canonicalKey = settingSchema.id;
    const level = opts?.level;

    // Route the value through the same gate as load. INVALID → no write (keep the old value).
    const resolved = resolveUpdateValue(value, settingSchema);
    if (resolved.invalid) return;

    if (level === "session") {
      // Buffer only — no file write. (Only meaningful in buffer mode.)
      applyToBuffer(canonicalKey, resolved.value);
      return;
    }

    if (level === "project" || level === "global") {
      // Explicit surgical one-key write to that file (preserves other keys), + sync the buffer in
      // buffer mode so a subsequent getSettings() reflects it.
      const path = level === "global" ? schema.globalPath(globalDir) : schema.projectPath(cwd);
      writeKeyToFile(path, canonicalKey, resolved.value);
      if (!singleFileLevel) applyToBuffer(canonicalKey, resolved.value);
      return;
    }

    // No level → mode-aware.
    if (singleFileLevel) {
      // Immediate read-modify-write of the single file. Stateless: no buffer, no env var.
      writeKeyToFile(singleFilePath(), canonicalKey, resolved.value);
    } else {
      // Buffer: update the buffer + clamp + env var (iff session is included).
      applyToBuffer(canonicalKey, resolved.value);
    }
  }

  function loadSettingsIntoMemory(cwdArg: string | undefined, globalDirArg: string | undefined): void {
    cwd = cwdArg ?? process.cwd();
    globalDir = globalDirArg;

    // Stateless: nothing to buffer (every read hits the file). Just fire the load hook.
    if (singleFileLevel) {
      onLoad?.();
      return;
    }

    try {
      // Env var first (subagent propagation + reload survival) — only when session is included.
      if (envVar && sessionIncluded) {
        const envSettings = process.env[envVar];
        if (envSettings) {
          const raw = JSON.parse(envSettings) as Record<string, unknown>;
          const parsed: Record<string, unknown> = Object.create(null);
          for (const key of Object.keys(raw)) parsed[key] = raw[key]; // Prevent prototype pollution
          settings = normalizeFromSchema(parsed, schema);
          clampSettings(settings, clampFn);
          settingsLoaded = true;
        }
      }

      if (!settingsLoaded) {
        const defaults = computeDefaults();
        settings = loadSettingsFromFiles(cwd, schema, defaults as unknown as Record<string, unknown>, globalDir);
        clampSettings(settings, clampFn);
        settingsLoaded = true;
      }
    } catch {
      settings = computeDefaults() as unknown as Record<string, unknown>;
      settingsLoaded = true;
    } finally {
      if (envVar && sessionIncluded) {
        process.env[envVar] = JSON.stringify(settings);
      }
      onLoad?.();
    }
  }

  function saveGlobalSettings(saveSettings: Record<string, unknown>, globalDirArg: string | undefined): void {
    if (globalDirArg !== undefined) globalDir = globalDirArg;
    _saveGlobalSettings(saveSettings, schema, globalDir);
  }

  function saveProjectSettings(saveSettings: Record<string, unknown>, cwdArg: string): void {
    cwd = cwdArg;
    _saveProjectSettings(saveSettings, cwd, schema);
  }

  return {
    getSettings,
    updateSetting,
    loadSettingsIntoMemory,
    saveGlobalSettings,
    saveProjectSettings,
    computeDefaults,
    schema,
    storageLevels,
  };
}
