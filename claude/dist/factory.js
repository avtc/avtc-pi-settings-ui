// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>
import { clampSettings, isInvalidResult, normalizeFromSchema, resolveSettingValue, validateSchema, } from "./normalization.js";
import { loadSettingsFromFiles, readJsonFile, writeJsonFile } from "./persistence.js";
import { normalizeStorageLevels } from "./schema.js";
/** Resolve a raw value through the gate, returning the default for the `undefined` reset sentinel. */
function resolveUpdateValue(raw, setting) {
    if (raw === undefined)
        return { value: setting.defaultValue, invalid: false };
    const resolved = resolveSettingValue({ [setting.id]: raw }, setting);
    if (isInvalidResult(resolved))
        return { invalid: true };
    return { value: resolved, invalid: false };
}
/**
 * Create a settings extension from a schema.
 *
 * The host wires `load` at startup (and on every session start) and reads via
 * `getSettings`; the pane persists explicitly (`persistToProject` /
 * `persistToGlobal`), so consumers never wire file IO by hand.
 */
export function createSettingsExtension(schema, options) {
    // Validate the schema up front (fail-fast): preset strings parse, every setting is in a tab,
    // every tab id resolves, no duplicate/orphan ids. Also eagerly populates the static-presets
    // cache so runtime resolution never re-throws.
    validateSchema(schema);
    const fs = options.fs;
    const env = options.env;
    const clampFn = options.clampFn;
    const envVar = options.envVar;
    const onLoad = options.onLoad;
    const storageLevels = normalizeStorageLevels(options.storageLevels);
    const sessionIncluded = storageLevels.includes("session");
    // The stateless single-file mode (pi's live-save parity): exactly ONE
    // file level (global or project, no session) routes every updateSetting
    // through a read-modify-write of that file — changes land on disk
    // immediately, no explicit save. Multi-level schemas keep BUFFER mode.
    const singleFileLevel = storageLevels.length === 1 && (storageLevels[0] === "global" || storageLevels[0] === "project");
    const singleFileKind = singleFileLevel
        ? storageLevels[0]
        : null;
    // serialized write-through chain (one write at a time; a rejected write
    // never breaks the chain — the next update tries again over fresh state)
    let writeChain = Promise.resolve();
    // Buffer state — every read hits the buffer; files load into it, persists write from it.
    let settings = {};
    let settingsLoaded = false;
    // cwd/globalDir learned via load (used by persists). The host always passes them
    // explicitly; the fallbacks keep a bare handle usable before its first load.
    let cwd = "";
    let globalDir;
    function computeDefaults() {
        const defaults = {};
        for (const setting of schema.settings) {
            defaults[setting.id] = setting.defaultValue;
        }
        return defaults;
    }
    function getSettings() {
        return settings;
    }
    /** Apply a resolved value to the buffer + clamp + serialize the env var. */
    function applyToBuffer(canonicalKey, resolvedValue) {
        settings[canonicalKey] = resolvedValue;
        settingsLoaded = true;
        clampSettings(settings, clampFn);
        if (envVar && sessionIncluded) {
            env.set(envVar, JSON.stringify(settings));
        }
    }
    function updateSetting(key, value, opts = {}) {
        const settingSchema = schema.settings.find((s) => s.id === key || s.aliases?.includes(key));
        if (!settingSchema)
            return;
        const canonicalKey = settingSchema.id;
        const level = opts?.level;
        // Route the value through the same gate as load. INVALID → no write (keep the old value).
        const resolved = resolveUpdateValue(value, settingSchema);
        if (resolved.invalid)
            return;
        if (level === "session") {
            // Buffer only — no file write.
            applyToBuffer(canonicalKey, resolved.value);
            return;
        }
        // Buffer update for project/global too: the explicit persist writes the file
        // (whole-buffer, preserving foreign keys); the buffer and env var reflect the
        // change immediately so a subsequent getSettings() sees it.
        applyToBuffer(canonicalKey, resolved.value);
        // The stateless live-save: write the key through to the single file
        // (read-modify-write, foreign keys preserved) — fire-and-forget, the
        // chain serializes concurrent updates.
        if (singleFileKind !== null) {
            const path = singleFileKind === "global" ? schema.globalPath(globalDir) : schema.projectPath(cwd);
            writeChain = writeChain
                .then(async () => {
                const existing = (await readJsonFile(fs, path)) ?? {};
                existing[canonicalKey] = resolved.value;
                const normalized = normalizeFromSchema(existing, schema);
                clampSettings(normalized, clampFn);
                for (const key of Object.keys(existing)) {
                    if (!(key in normalized) && !schema.settings.some((sc) => sc.id === key || sc.aliases?.includes(key))) {
                        normalized[key] = existing[key];
                    }
                }
                await writeJsonFile(fs, path, normalized);
            })
                .catch(() => {
                /* a failed write-through retries on the next update (fresh read) */
            });
        }
    }
    async function load(cwdArg, globalDirArg) {
        cwd = cwdArg ?? cwd;
        globalDir = globalDirArg;
        try {
            // Env var first (subagent propagation + reload survival) — only when session is included.
            if (envVar && sessionIncluded) {
                const envSettings = await env.get(envVar);
                if (envSettings) {
                    const raw = JSON.parse(envSettings);
                    const parsed = Object.create(null);
                    for (const key of Object.keys(raw))
                        parsed[key] = raw[key]; // Prevent prototype pollution
                    settings = normalizeFromSchema(parsed, schema);
                    clampSettings(settings, clampFn);
                    settingsLoaded = true;
                }
            }
            if (!settingsLoaded) {
                const defaults = computeDefaults();
                settings = await loadSettingsFromFiles(fs, cwd, schema, defaults, globalDir);
                clampSettings(settings, clampFn);
                settingsLoaded = true;
            }
        }
        catch {
            settings = computeDefaults();
            settingsLoaded = true;
        }
        finally {
            if (envVar && sessionIncluded) {
                env.set(envVar, JSON.stringify(settings));
            }
            onLoad?.();
        }
    }
    /** Write the buffer over one file level: read the file, overlay the buffer's
     *  schema keys (foreign keys survive — restored after the schema projection),
     *  normalize, whole-file write. */
    async function persistTo(path) {
        const existing = (await readJsonFile(fs, path)) ?? {};
        const merged = { ...existing, ...settings };
        const normalized = normalizeFromSchema(merged, schema);
        clampSettings(normalized, clampFn);
        // Foreign keys (not in the schema) survive the rewrite untouched.
        for (const key of Object.keys(existing)) {
            if (!(key in normalized) && !schema.settings.some((s) => s.id === key || s.aliases?.includes(key))) {
                normalized[key] = existing[key];
            }
        }
        await writeJsonFile(fs, path, normalized);
    }
    async function persistToGlobal() {
        if (singleFileKind === "global") {
            await writeChain; // the writes already went through — flush
            return;
        }
        await persistTo(schema.globalPath(globalDir));
    }
    async function persistToProject(cwdArg) {
        cwd = cwdArg ?? cwd;
        if (singleFileKind === "project") {
            await writeChain; // the writes already went through — flush
            return;
        }
        await persistTo(schema.projectPath(cwd));
    }
    return {
        getSettings,
        updateSetting,
        load,
        persistToGlobal,
        persistToProject,
        computeDefaults,
        schema,
        storageLevels,
    };
}
