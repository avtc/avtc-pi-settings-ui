// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

// Minimal public API for the Claude variant. Everything else (normalization
// internals, the tab-group builder, the pane controller internals) is
// internal — import it from its `src/` path only if you have a specific
// reason not covered here.

// Context capture — the host stashes its models list at pane-open.
export { captureCtx } from "./ctx-store.js";
export type { EnvStore } from "./factory.js";
// The settings store — create the handle over injected fs/env seams.
export { createSettingsExtension } from "./factory.js";
export type { FsAdapter } from "./fs-adapter.js";
export type {
  PaneController,
  PaneControllerOptions,
  PaneHandle,
  PaneNotify,
  PaneStorageLevels,
} from "./pane/controller.js";
// The pane — the interaction model + tree composition a host's ui.render hook drives.
export { createPaneController } from "./pane/controller.js";
export type { PaneElements, PaneTreeOptions } from "./pane/tree.js";
export { buildPaneTree } from "./pane/tree.js";
// Persistence — the standard global/project file-path pair every consumer spreads into its schema.
export { settingsFilePaths } from "./persistence.js";
export type {
  RegisterSettingsOptions,
  RegisterSettingsSeams,
  SettingsHandle,
} from "./register-settings-command.js";
// The migration entry — the terminal variant's registration name, rebuilt
// over the injected seams (the handle loads once and comes back).
export { loadSettingsHandle, registerSettingsCommand } from "./register-settings-command.js";
// Authoring types — the schema a consumer writes.
export type {
  PresetElement,
  PresetPair,
  PresetsSource,
  PresetValue,
  SettingSchema,
  SettingsSchema,
  SettingsTabSchema,
  StorageLevel,
} from "./schema.js";
export type { TypeContext, TypeDefinition } from "./type-definitions.js";
// Type system — register a custom TypeDefinition (the built-in 7 are pre-registered).
export { registerTypeDefinition } from "./type-definitions.js";

// Display helper — the human form of a duration (the inverse of the `duration` type's parse).
export { formatHumanDuration } from "./validation.js";
