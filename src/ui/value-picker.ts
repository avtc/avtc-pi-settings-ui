// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * ValuePickerSubmenu — filter-first preset value picker.
 *
 * A persistent top filter field plus a filtered list of presets. A pinned "Custom value…" row
 * (open types only) switches the top field into a text-entry state. The current value absent
 * from presets surfaces as a pinned custom-indicator. Model entries mute their `[provider]` span
 * via pi's Theme. Tab/Shift+Tab are inert (no tab-switching while picking).
 */

import { getSettingsListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { getKeybindings, Input, Key, matchesKey } from "@earendil-works/pi-tui";
import { validateCustomValue } from "../custom-validation.js";
import { splitModelId } from "../model-presets.js";
import type { PresetItem, PresetPair, SettingType } from "../schema.js";
import { formatRawForDisplay, getTypeDefinition, type TypeContext, type TypeDefinition } from "../type-definitions.js";
import { computeViewport, handlePickerNavigation, renderPickerLine } from "./picker-helpers.js";

/** Theme label bold flag */
const BOLD = true;
/** Theme value non-bold flag */
const NOT_BOLD = false;

/** Default picker viewport cap (matches pi's native /settings visible-row count). The modal
 *  passes a terminal-aware `maxVisible` so the dropdown never grows the reserved slot. */
export const PICKER_VIEWPORT_MAX = 10;

/** Entry in the value picker: display label paired with the raw typed value. */
interface PickerEntry {
  label: string;
  rawValue: string | number | boolean | null;
  kind: "preset" | "custom-indicator" | "custom";
}

export class ValuePickerSubmenu implements Component {
  /** Top-field state: filter mode (keystrokes filter) or text-entry mode (keystrokes build a
   *  custom value, entered via the pinned "Custom value…" row). */
  private mode: "filter" | "text-entry" = "filter";
  private selectedIndex = 0;
  private filterInput: Input;
  private errorMessage = "";
  private closed = false;
  /** Snapshot of the filter text captured on entering text-entry mode; restored on Esc so the
   *  filtered list does not collapse to an empty filter. Cleared on leaving text-entry mode. */
  private customEntryFilterSnapshot = "";

  /** The SettingsListTheme used for row rendering (cursor/label/value/hint/description), fetched
   *  via the global getter — NOT a constructor param. The pi `Theme` constructor param is used
   *  only for `fg("muted", ...)` model-span muting. */
  private readonly listTheme = getSettingsListTheme();
  /** True iff this picker is for a `model`-type setting (constructor-time fact — muting applies). */
  private readonly isModel: boolean;

  private readonly entries: PickerEntry[];
  private readonly typeDef: TypeDefinition;
  private readonly ctx: TypeContext;

  /** Max rows the picker viewport ever shows. The owning modal passes a value sized to its
   *  reserved slot so opening the dropdown cannot change the modal's height. Required (no
   *  default) per the no-optional-params lint — callers pass PICKER_VIEWPORT_MAX explicitly. */
  private readonly maxVisible: number;

  constructor(
    presets: readonly PresetItem[],
    currentRawValue: string,
    private settingType: SettingType,
    private theme: Theme,
    private done: (value?: unknown) => void,
    maxVisible: number,
  ) {
    this.maxVisible = maxVisible;
    this.filterInput = new Input();
    this.typeDef = getTypeDefinition(settingType);
    this.isModel = settingType === "model";
    // Build a TypeContext from presets (a custom parse/format derives the null label itself from
    // ctx.presets — the pair whose value is null).
    this.ctx = { presets: presets.map((p): PresetPair => [p.label, p.rawValue]) };

    // Build entries: label for display, raw value for done callback.
    // currentRawValue (serialized string) is matched against preset displayValue to find the active preset.
    const matchIndex = presets.findIndex((p) => p.displayValue === currentRawValue);
    const hasCustomIndicator = matchIndex < 0;

    this.entries = [];
    if (hasCustomIndicator) {
      this.entries.push({
        label: `◆ ${this.formatForDisplay(currentRawValue)}`,
        rawValue: currentRawValue,
        kind: "custom-indicator",
      });
    }
    for (const preset of presets) {
      this.entries.push({ label: preset.label, rawValue: preset.rawValue, kind: "preset" });
    }
    // Pinned "Custom value…" row (open types only): free-form entry via Up/Down + Enter, which
    // switches the top field into text-entry mode. Distinguished by kind (rawValue is null, which
    // is a valid preset value).
    if (this.typeDef.supportsCustomValues) {
      this.entries.push({ label: "Custom value…", rawValue: null, kind: "custom" });
    }

    // Initialize selection: the custom-indicator if present (index 0), else the active preset —
    // offset by the pinned rows that sit above the filtered presets (reuses the same offset the
    // filter-change reset uses, so the two stay in sync).
    if (hasCustomIndicator) {
      this.selectedIndex = 0;
    } else {
      this.selectedIndex = this.presetOffset + matchIndex;
    }

    // The top field is the filter; in text-entry mode it builds a custom value.
    this.filterInput.focused = true;
  }

  /** Format a serialized raw value for display via the TypeDefinition. */
  private formatForDisplay(rawValue: string): string {
    if (rawValue === "") return "";
    // Shared coerce → typeof-number-guard → format (type-definitions.formatRawForDisplay):
    // a non-numeric label (e.g. a defensive null's "Infinite") is returned verbatim rather than
    // fed through format (which would render "NaNs").
    return formatRawForDisplay(rawValue, this.typeDef, this.ctx);
  }

  /** The custom-indicator entry (pinned above the filtered list, exempt from the filter), if any. */
  private get customIndicator(): PickerEntry | undefined {
    return this.entries.find((e) => e.kind === "custom-indicator");
  }

  /** The pinned "Custom value…" entry (open types only), exempt from the filter. */
  private get customRow(): PickerEntry | undefined {
    return this.entries.find((e) => e.kind === "custom");
  }

  /** Presets filtered by a case-insensitive substring over label OR serialized raw value. */
  private get filteredPresets(): PickerEntry[] {
    const needle = this.filterInput.getValue().toLowerCase();
    const presets = this.entries.filter((e) => e.kind === "preset");
    if (!needle) return presets;
    return presets.filter((e) => {
      const haystack = `${e.label} ${String(e.rawValue)}`.toLowerCase();
      return haystack.includes(needle);
    });
  }

  /** The full navigable list (order matters — selectedIndex indexes this): the pinned rows
   *  (custom-indicator AND "Custom value…") sit ABOVE the filtered presets (both exempt from the
   *  filter), then the filtered presets. */
  private get visibleEntries(): PickerEntry[] {
    const result: PickerEntry[] = [];
    const indicator = this.customIndicator;
    if (indicator) result.push(indicator);
    const row = this.customRow;
    if (row) result.push(row);
    result.push(...this.filteredPresets);
    return result;
  }

  /** Offset of the first filtered preset within visibleEntries (the count of pinned rows above).
   *  Used to map a preset's match index onto its visibleEntries position. */
  private get presetOffset(): number {
    let offset = 0;
    if (this.customIndicator) offset++;
    if (this.customRow) offset++;
    return offset;
  }

  /** Focus the first matching PRESET (the pinned rows sit above the filtered list but are not
   *  matches), or fall back to the top pinned row when nothing matches. */
  private focusFirstMatch(): void {
    this.selectedIndex = this.filteredPresets.length > 0 ? this.presetOffset : 0;
  }

  render(width: number): string[] {
    if (this.mode === "text-entry") {
      return this.renderTextEntry(width);
    }
    return this.renderFilter(width);
  }

  private renderFilter(width: number): string[] {
    const lines: string[] = [];
    lines.push(...this.filterInput.render(width));

    const entries = this.visibleEntries;
    const { start: visibleStart, end: visibleEnd } = computeViewport(
      this.selectedIndex,
      entries.length,
      this.maxVisible,
    );

    if (entries.length === 0) {
      lines.push(this.listTheme.hint("  No matches"));
      return lines;
    }

    for (let i = visibleStart; i < visibleEnd; i++) {
      const entry = entries[i];
      if (!entry) continue;
      lines.push(this.renderEntry(i === this.selectedIndex, entry));
    }

    // Inline position indicator on the hint line (mirrors pi-tui SelectList's `(n/N)`), kept on the
    // existing hint row so it never adds a line — the modal's reserved slot stays exact and the
    // dropdown opening cannot change the modal height.
    const scrolling = visibleStart > 0 || visibleEnd < entries.length;
    const hint = scrolling
      ? `  Enter to select · Esc to go back · (${this.selectedIndex + 1}/${entries.length})`
      : "  Enter to select · Esc to go back";
    lines.push(this.listTheme.hint(hint));
    return lines;
  }

  /** Render a single entry line with the cursor prefix, applying muted model-span theming
   *  (only to actual model presets — the custom-indicator renders its label verbatim). */
  private renderEntry(isSelected: boolean, entry: PickerEntry): string {
    if (this.isModel && entry.kind === "preset" && typeof entry.rawValue === "string" && entry.rawValue.includes("/")) {
      // Model entry: isolate the provider from the VALUE (before the first '/'), not the label.
      const parts = splitModelId(entry.rawValue);
      const badge = this.theme.fg("muted", ` [${parts?.provider ?? ""}]`);
      // No outer space — the space is the first char inside the muted badge (mirrors pi).
      const idText = parts?.id ?? entry.rawValue;
      const composedSelected = this.listTheme.label(idText, BOLD) + badge;
      const composedUnselected = this.listTheme.value(idText, NOT_BOLD) + badge;
      return renderPickerLine(isSelected, this.listTheme, composedSelected, composedUnselected);
    }
    return renderPickerLine(
      isSelected,
      this.listTheme,
      this.listTheme.label(entry.label, BOLD),
      this.listTheme.value(entry.label, NOT_BOLD),
    );
  }

  private renderTextEntry(width: number): string[] {
    const lines: string[] = [];
    lines.push(this.listTheme.hint("custom:"));
    lines.push(...this.filterInput.render(width));
    if (this.errorMessage) {
      lines.push(this.listTheme.description(this.errorMessage));
    }
    return lines;
  }

  handleInput(data: string): void {
    if (this.closed) return;

    if (this.mode === "text-entry") {
      this.handleTextEntryInput(data);
      return;
    }
    this.handleFilterInput(data);
  }

  private handleFilterInput(data: string): void {
    const kb = getKeybindings();

    // Up/Down move within the filtered set (+pinned rows).
    const entries = this.visibleEntries;
    const navIndex = handlePickerNavigation(kb, data, this.selectedIndex, entries.length);
    if (navIndex !== undefined) {
      this.selectedIndex = navIndex;
      return;
    }

    // Enter selects the focused entry (preset/indicator) or activates text-entry (Custom row).
    if (kb.matches(data, "tui.select.confirm") || data === "\r" || data === "\n") {
      this.activateEntry();
      return;
    }

    // Esc cancels (returns to the main list).
    if (kb.matches(data, "tui.select.cancel")) {
      this.closed = true;
      this.done();
      return;
    }

    // Tab / Shift+Tab are inert inside the picker (no tab-switching while picking).
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) {
      return;
    }

    // Left/Right move the filter cursor; everything else (printables + editing keys —
    // Backspace/Delete/word-delete/line-clear) feeds the filter field (default sink). When the
    // filter text changes, focus the first matching PRESET (the pinned rows sit above the filtered
    // list but are not matches) — or index 0 (the top pinned row) when nothing matches. Cursor
    // movement that leaves the text intact must not move the selection.
    const before = this.filterInput.getValue();
    this.filterInput.handleInput(data);
    if (this.filterInput.getValue() !== before) {
      this.focusFirstMatch();
    }
  }

  private handleTextEntryInput(data: string): void {
    const kb = getKeybindings();
    if (kb.matches(data, "tui.select.confirm") || data === "\r" || data === "\n") {
      this.submitCustomValue();
      return;
    }
    if (kb.matches(data, "tui.select.cancel")) {
      this.leaveTextEntry();
      return;
    }
    if (this.errorMessage) this.errorMessage = "";
    this.filterInput.handleInput(data);
  }

  /** Enter on the focused entry: preset/indicator → done(rawValue); Custom row → text-entry mode. */
  private activateEntry(): void {
    const entry = this.visibleEntries[this.selectedIndex];
    if (!entry) return;
    if (entry.kind === "custom") {
      this.enterTextEntry();
      return;
    }
    this.closed = true;
    this.done(entry.rawValue);
  }

  private enterTextEntry(): void {
    this.customEntryFilterSnapshot = this.filterInput.getValue();
    this.filterInput.setValue("");
    this.mode = "text-entry";
    this.errorMessage = "";
  }

  private leaveTextEntry(): void {
    this.filterInput.setValue(this.customEntryFilterSnapshot);
    this.customEntryFilterSnapshot = "";
    this.mode = "filter";
    this.errorMessage = "";
    this.focusFirstMatch();
  }

  /** Validate the typed custom value; on success fire done(rawValue), on failure show the error. */
  private submitCustomValue(): void {
    const result = validateCustomValue(this.filterInput.getValue(), this.settingType, this.ctx);
    if (result === undefined) {
      this.errorMessage = `  \u26a0 ${this.typeDef.errorMessage}`;
      return;
    }
    this.closed = true;
    this.done(result);
  }

  invalidate(): void {
    this.filterInput.invalidate();
  }
}
