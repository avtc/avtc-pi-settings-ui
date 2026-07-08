// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * High-level settings modal and command registration.
 *
 * {@link registerSettingsCommand} is the single public entry point: it creates the settings
 * handle internally, registers the /<name> command + modal, wires auto-load (registration +
 * every session_start), and returns the handle for runtime reads. Consumers only need to
 * define a schema and call it once.
 *
 * Usage:
 * ```ts
 * const handle = registerSettingsCommand(pi, MY_SCHEMA, {
 *   commandName: "my-settings",
 *   title: "My Extension Settings",
 *   titleRight: "avtc-pi-my-extension",
 *   envVar: "PI_MY_SETTINGS",
 * });
 * ```
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { captureCtx } from "../ctx-store.js";
import { createSettingsExtension } from "../factory.js";
import { resolveFunctionPresets } from "../preset-resolver.js";
import { normalizeStorageLevels, type SettingsSchema, type StorageLevel } from "../schema.js";

export type { StorageLevel } from "../schema.js";
// Re-export for the existing test/index imports (StorageLevel + normalizeStorageLevels live in schema.ts).
export { normalizeStorageLevels } from "../schema.js";

import { subscribeToDialogCoordinator, withCoordinator } from "../snippets/vendored/subscribe-to-dialog-coordinator.js";
import { ModalFrame } from "./modal-frame.js";
import { buildSchemaTabGroups } from "./schema-tabs.js";
import { SettingsTabsModal } from "./settings-modal.js";

/** Sentinel for "no global-dir override" — passed to the handle's load/save so they use the default (~/.pi). */
const NO_GLOBAL_DIR: string | undefined = undefined;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of createSettingsExtension — the full settings API object (internal; modal + registerSettingsCommand use it). */
export interface SettingsHandleInternal<S = Record<string, unknown>> {
  getSettings: () => S;
  updateSetting: (key: string, value: unknown, opts?: { level?: StorageLevel }) => void;
  loadSettingsIntoMemory: (cwd?: string, globalDir?: string) => void;
  saveGlobalSettings: (settings: Record<string, unknown>, globalDir?: string) => void;
  saveProjectSettings: (settings: Record<string, unknown>, cwd: string) => void;
  computeDefaults: () => S;
  schema: SettingsSchema;
  /** Which persistence levels this handle offers (source of truth; the modal inherits it). */
  storageLevels: StorageLevel[];
}

/**
 * The public settings handle returned by {@link registerSettingsCommand}. Consumers read settings
 * via `getSettings()`, write via `updateSetting()`, and inspect `storageLevels`. Loading
 * (registration + every `session_start`) and persistence are handled internally — no manual
 * load/save is exposed.
 */
export interface SettingsHandle<S = Record<string, unknown>> {
  /** Read the current settings (normalized by the schema). */
  getSettings: () => S;
  /** Write one setting (mode-aware: buffer or immediate file write; persists + syncs env var). */
  updateSetting: (key: string, value: unknown, opts?: { level?: StorageLevel }) => void;
  /** Which persistence levels this handle offers (`session`/`project`/`global`). */
  storageLevels: StorageLevel[];
}

export interface SettingsModalOptions {
  /** Command name registered on pi (e.g. "subagent-settings"). */
  commandName: string;
  /** Title displayed in the modal frame border. */
  title: string;
  /** Optional right-aligned subtitle in the border (e.g. "avtc-pi-subagent"). */
  titleRight?: string;
  /**
   * Optional hook called after a setting changes. Receives (id, newValue).
   * Use for side effects beyond the standard updateSetting (which handles persistence +
   * env-var serialization itself).
   */
  onAfterChange?: (id: string, newValue: unknown) => void;
  /**
   * Optional hook called before the modal opens. Receives the command context.
   * Use for stashing context data (e.g. newSession function) needed by other handlers.
   */
  beforeOpen?: (ctx: ExtensionCommandContext) => void;
}

/**
 * Options for {@link registerSettingsCommand} — combines the settings store (storageLevels,
 * clampFn, envVar, onLoad) with the command/modal (commandName, title, titleRight, …).
 * The store fields are passed to the internally-created handle; the modal fields drive the UI.
 */
export interface RegisterSettingsOptions {
  // Command / modal
  /** Command name registered on pi (e.g. "my-extension:settings"). */
  commandName: string;
  /** Title displayed in the modal frame border. */
  title: string;
  /** Optional right-aligned subtitle in the border (e.g. "avtc-pi-my-extension"). */
  titleRight?: string;
  /** Optional hook called after a setting changes. Receives (id, newValue). */
  onAfterChange?: (id: string, newValue: unknown) => void;
  /** Optional hook called before the modal opens. Receives the command context. */
  beforeOpen?: (ctx: ExtensionCommandContext) => void;
  // Settings store
  /** Which storage levels the handle offers (default: all three). Source of truth for the modal. */
  storageLevels?: StorageLevel[];
  /** Optional cross-field constraint applied after normalization. */
  clampFn?: (result: Record<string, unknown>) => void;
  /** Optional env var for propagating settings to subagents (active when `session` is a level). */
  envVar?: string;
  /** Optional hook called after the handle loads settings (registration + each session_start). */
  onLoad?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAVE_AS_PROJECT_KEY = "\x13"; // Ctrl+S
const SAVE_AS_DEFAULT_KEY = "\x04"; // Ctrl+D

const LEVEL_PROJECT: StorageLevel = "project";
const LEVEL_GLOBAL: StorageLevel = "global";

const HELP_NAV_LINE = "Esc | ↑↓: navigate | ←→: filter cursor | Tab/Shift+Tab: switch tab | Enter: change";

/** Build the modal help text. Always composes the navigation line, plus a storage portion.
 *  Single level → an auto-persist note (stateless handles write each edit immediately via
 *  updateSetting; a session-only handle is in-memory); multiple levels → the enabled save keys
 *  only (Ctrl+S project, Ctrl+D global). */
export function buildHelpText(storageLevels: StorageLevel[]): string {
  if (storageLevels.length === 1) {
    return `${HELP_NAV_LINE} · Changes save to ${storageLevels[0]} automatically`;
  }
  const keys: string[] = [];
  if (storageLevels.includes(LEVEL_PROJECT)) keys.push("Ctrl+S: save project");
  if (storageLevels.includes(LEVEL_GLOBAL)) keys.push("Ctrl+D: save global");
  return keys.length > 0 ? `${HELP_NAV_LINE} | ${keys.join(" | ")}` : HELP_NAV_LINE;
}

// ---------------------------------------------------------------------------
// openSettingsModal
// ---------------------------------------------------------------------------

/**
 * Open the settings modal for a given settings handle + options.
 *
 * Handles: ModalFrame wrapping, SettingsTabsModal, onChange with
 * updateSetting + env var serialization, Ctrl+S/D save persistence.
 */
export async function openSettingsModal<S = Record<string, unknown>>(
  ctx: ExtensionCommandContext,
  handle: SettingsHandleInternal<S>,
  options: SettingsModalOptions,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify(`/${options.commandName} requires interactive TUI mode.`, "warning");
    return;
  }

  const overlayOptions = { anchor: "center" as const, width: "90%" as const, maxHeight: "90%" as const, margin: 1 };
  const { onAfterChange, beforeOpen } = options;

  // Storage levels are inherited from the handle (the factory is the single source of truth):
  // dedup + drop non-union/typos before the count rule. single-level = auto-persist note + no
  // save keys (a stateless handle writes each edit immediately via updateSetting; session-only
  // is in-memory); multi-level = save-key mode (Ctrl+S/D for the enabled file levels).
  const normalizedLevels = normalizeStorageLevels(handle.storageLevels);
  const singleLevel = normalizedLevels.length === 1;

  beforeOpen?.(ctx);

  // Stash the command context (modelRegistry + cwd) for resolvers that read it later
  // (the model type-def's preset resolver). Runs before the resolvers are invoked below.
  captureCtx(ctx);

  let settingsTabs: SettingsTabsModal | undefined;

  await withCoordinator(async () => {
    await ctx.ui.custom<void>(
      async (tui, theme: Theme, _keybindings, done) => {
        // Resolve every function-presets source once, at open (the model resolver's live list).
        // Closed over by the still-synchronous buildTabs below so re-invocations (tab sync,
        // filter rebuilds) reuse the single per-open map instead of re-hitting the registry.
        const { pairs: resolvedPairs, failedIds } = await resolveFunctionPresets(handle.schema);
        // A resolver that threw/rejected degrades to defaults (modal still opens); tell the user
        // which setting's options could not load so an empty picker is not a mystery.
        if (failedIds.length > 0) {
          ctx.ui.notify(`⚠ Could not load options for: ${failedIds.join(", ")}. Showing defaults.`, "warning");
        }

        settingsTabs = new SettingsTabsModal(
          {
            title: options.title,
            buildTabs: () => {
              const settings = handle.getSettings() as unknown as Record<string, unknown>;
              return buildSchemaTabGroups(settings, handle.schema, resolvedPairs);
            },
            onChange: (id, newValue) => {
              if (id.startsWith("__")) return;

              // updateSetting owns ALL persistence: stateless handles read-modify-write the file
              // immediately; buffer handles update the buffer + serialize the env var (when session
              // is included). The modal adds nothing here — onAfterChange is for consumer side
              // effects beyond the standard update path.
              handle.updateSetting(id, newValue);
              onAfterChange?.(id, newValue);

              if (settingsTabs) {
                settingsTabs.syncActiveTab();
              }
            },
            onClose: () => done(),
            enableSearch: false,
          },
          theme,
          tui,
        );

        const modal = new ModalFrame({
          title: options.title,
          titleRight: options.titleRight,
          content: settingsTabs,
          helpText: buildHelpText(normalizedLevels),
        });

        return {
          render(width: number) {
            return modal.render(width);
          },
          invalidate() {
            settingsTabs?.invalidate();
          },
          handleInput(data: string) {
            // Ctrl+S / Ctrl+D persist the buffer to a file level (save-key mode). Only offered in
            // MULTI-level mode — a single-level handle auto-persists (stateless writes each edit
            // via updateSetting; session-only is in-memory), so there is nothing to bulk-save. The
            // keys are always consumed here (modal-level) so they never reach the list.
            if (data === SAVE_AS_PROJECT_KEY) {
              if (!singleLevel && normalizedLevels.includes(LEVEL_PROJECT)) {
                handle.saveProjectSettings(handle.getSettings() as unknown as Record<string, unknown>, process.cwd());
                ctx.ui.notify("Settings saved to project.", "info");
              }
              return;
            }
            if (data === SAVE_AS_DEFAULT_KEY) {
              if (!singleLevel && normalizedLevels.includes(LEVEL_GLOBAL)) {
                handle.saveGlobalSettings(handle.getSettings() as unknown as Record<string, unknown>);
                ctx.ui.notify("Settings saved as global default.", "info");
              }
              return;
            }
            settingsTabs?.handleInput(data);
            tui.requestRender();
          },
        };
      },
      { overlay: true, overlayOptions },
    );
  });
}

// ---------------------------------------------------------------------------
// registerSettingsCommand
// ---------------------------------------------------------------------------

/**
 * Register a settings command + modal and wire up auto-load + session_start handler.
 *
 * Call this in your extension's activate function (where `pi` is available). It creates the
 * settings handle internally (from the schema + store options), so callers register and get a
 * handle in one step. Auto-load runs at registration (process.cwd()) and again on every
 * session_start (ctx.cwd), so settings are fresh for each session — no manual loading. Handles:
 * - /command-name registration
 * - loadSettingsIntoMemory at registration + on session_start (env-var serialization is inside it)
 */
export function registerSettingsCommand<S extends object = Record<string, unknown>>(
  pi: ExtensionAPI,
  schema: SettingsSchema,
  options: RegisterSettingsOptions,
): SettingsHandle<S> {
  // Build the settings handle (the store) — pi-independent; created here so callers register +
  // get a handle in one step. The returned handle is what they read settings from at runtime.
  const handle = createSettingsExtension<S>(schema, {
    storageLevels: options.storageLevels,
    clampFn: options.clampFn,
    envVar: options.envVar,
    onLoad: options.onLoad,
  });

  // Subscribe to dialog coordinator so openSettingsModal's withCoordinator wrapping works
  subscribeToDialogCoordinator(pi);

  // Load settings now (registration time) so they're available before the first session — every
  // session_start re-loads them. env-var serialization (when session is included) is inside it.
  handle.loadSettingsIntoMemory(process.cwd(), NO_GLOBAL_DIR);

  // Register the settings command. `options` carries the modal fields (commandName/title/…).
  pi.registerCommand(options.commandName, {
    description: `Configure ${options.title}`,
    async handler(_args: unknown, ctx: ExtensionCommandContext) {
      await openSettingsModal(ctx, handle, options);
    },
  });

  // Re-load settings on session start (handles /reload + per-session cwd)
  pi.on("session_start", async (_event: unknown, ctx: unknown) => {
    const cwd = (ctx as { cwd?: string } | undefined)?.cwd;
    if (cwd) {
      handle.loadSettingsIntoMemory(cwd, NO_GLOBAL_DIR);
    }
  });

  return handle;
}
