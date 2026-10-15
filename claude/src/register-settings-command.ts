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

import { createSettingsExtension, type EnvStore } from "./factory.js";
import type { FsAdapter } from "./fs-adapter.js";
import type { SettingsSchema, StorageLevel } from "./schema.js";

/** The public settings handle (the terminal variant's shape — what consumers read). */
export interface SettingsHandle<S = Record<string, unknown>> {
  /** Read the current settings (normalized by the schema). */
  getSettings: () => S;
  /** Write one setting (mode-aware; persists + syncs the env var). */
  updateSetting: (key: string, value: unknown, opts?: { level?: StorageLevel }) => void;
  /** Which persistence levels this handle offers. */
  storageLevels: StorageLevel[];
}

/** The registration options (the terminal variant's authoring surface — the
 *  command/modal fields are honored by hosts that own a surface). */
export interface RegisterSettingsOptions {
  commandName?: string;
  title?: string;
  titleRight?: string;
  onAfterChange?: (id: string, newValue: unknown) => void;
  storageLevels?: StorageLevel[];
  clampFn?: (result: Record<string, unknown>) => void;
  envVar?: string;
  onLoad?: () => void;
}

/** The seam bundle the entry builds over (injected fs + env + identity). */
export interface RegisterSettingsSeams {
  fs: FsAdapter;
  env: EnvStore;
  cwd?: string;
  globalDir?: string;
}

/** Build + load the settings handle; resolves once the ladder has settled. */
export async function loadSettingsHandle<S extends object = Record<string, unknown>>(
  schema: SettingsSchema,
  seams: RegisterSettingsSeams,
  options?: RegisterSettingsOptions,
): Promise<ReturnType<typeof createSettingsExtension<S>>> {
  const handle = createSettingsExtension<S>(schema, {
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
export function registerSettingsCommand<S extends object = Record<string, unknown>>(
  pi: unknown,
  schema: SettingsSchema,
  options?: RegisterSettingsOptions & Partial<RegisterSettingsSeams>,
): SettingsHandle<S> {
  void pi;
  const built = createSettingsExtension<S>(schema, {
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
