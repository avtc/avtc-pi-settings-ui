// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>
/**
 * The name-compatible registration entry for hosts migrating from the
 * terminal variant. The terminal `registerSettingsCommand(pi, schema,
 * options)` registered a command + modal on the host API and returned the
 * handle synchronously; this variant owns no command surface (the host
 * opens the pane itself), so the entry builds the settings handle over the
 * injected seams and returns it — the load fires in the background and the
 * first reads see defaults until it settles (hosts that need loaded data
 * await `loadSettingsHandle`).
 */
import { createSettingsExtension } from "./factory.js";
/** Build + load the settings handle; resolves once the ladder has settled. */
export async function loadSettingsHandle(schema, seams, options) {
    const handle = createSettingsExtension(schema, {
        fs: seams.fs,
        env: seams.env,
        storageLevels: options?.storageLevels,
        clampFn: options?.clampFn,
        envVar: options?.envVar,
        onLoad: options?.onLoad,
    });
    await handle.load(seams.cwd, seams.globalDir);
    return handle;
}
/** The pi-shaped registration entry: builds the handle synchronously (the
 *  terminal call shape — the host argument is opaque here, never touched)
 *  and fires the load in the background. Hosts wanting settled data await
 *  {@link loadSettingsHandle} instead. */
export function registerSettingsCommand(pi, schema, options) {
    void pi;
    const built = createSettingsExtension(schema, {
        fs: options?.fs ?? {
            read: async () => null,
            write: async () => undefined,
        },
        env: options?.env ?? { get: () => undefined, set: () => undefined },
        storageLevels: options?.storageLevels,
        clampFn: options?.clampFn,
        envVar: options?.envVar,
        onLoad: options?.onLoad,
    });
    void built.load(options?.cwd, options?.globalDir);
    return built;
}
