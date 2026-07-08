// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

// Minimal public API. Everything else (the settings handle factory, normalization internals,
// persistence helpers, UI components, display/coerce helpers, built-in type-def knobs) is
// internal — import it from its `src/` path only if you have a specific reason not covered here.

// Persistence — the standard global/project file-path pair every consumer spreads into its schema.
export { settingsFilePaths } from "./src/persistence.js";
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
} from "./src/schema.js";
export type { TypeContext, TypeDefinition } from "./src/type-definitions.js";
// Type system — register a custom TypeDefinition (the built-in 7 are pre-registered).
export { registerTypeDefinition } from "./src/type-definitions.js";
export type { RegisterSettingsOptions, SettingsHandle } from "./src/ui/settings-command.js";
// Command registration — the single entry point: registers the /<name> command + modal and
// returns the settings handle (what you call getSettings/updateSetting on at runtime).
export { registerSettingsCommand } from "./src/ui/settings-command.js";

// Display helper — the human form of a duration (the inverse of the `duration` type's parse).
export { formatHumanDuration } from "./src/validation.js";
