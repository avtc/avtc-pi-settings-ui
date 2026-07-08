// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * SettingsTabsModal — tabbed settings dialog content renderer.
 *
 * Generic modal content that renders tabs of settings using pi-tui components.
 * Designed to be used inside ModalFrame.
 */

import { getSettingsListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import {
  Box,
  Container,
  Input,
  Key,
  matchesKey,
  SettingsList,
  Spacer,
  Text,
  type SettingItem as TuiSettingItem,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { SettingItem, TabDefinition } from "../schema.js";
import { PICKER_VIEWPORT_MAX, ValuePickerSubmenu } from "./value-picker.js";

export interface TabSettingsOptions {
  title: string;
  buildTabs: () => TabDefinition[];
  onChange: (id: string, value: unknown) => void;
  onClose: () => void;
  enableSearch?: boolean;
  /** Optional description lookup — id → description text */
  getDescription?: (id: string) => string | undefined;
}

/** Line overhead for maxVisible calculation in the settings dialog.
 *  ModalFrame frame = 2 (top border + bottom border)
 *  filter field = 1 (the always-active modal filter Input above the tab bar)
 *  pre-list = 2 (tab bar + spacer)
 *  hintLines = 2 (empty line + hint text from SettingsList.addHintLine)
 *  descSpacer = 1 (spacer between hint and description)
 *  descArea = 3 (fixed description lines appended in render())
 *  helpText = 1 (help text below bottom border from ModalFrame)
 *  overlayMargin = 2 (top + bottom margin=1 from overlay options)
 *  Total = 2 + 1 + 2 + 2 + 1 + 3 + 1 + 2 = 14
 */
const SETTINGS_DIALOG_OVERHEAD = 14;

/** Empty filter text — the live filter on a fresh modal open. Named (not a bare "") per lint. */
const EMPTY_FILTER = "";

/** Sentinel: no TUI provided for settings modal */
export const NO_TUI: { terminal?: { rows?: number } } | undefined = undefined;

export class SettingsTabsModal implements Component {
  private buildTabsFn: () => TabDefinition[];
  /** Tabs built once per open / tab switch (cached so filter keystrokes do NOT re-run
   *  buildSchemaTabGroups). Refreshed by the constructor and switchTab. */
  private cachedTabs: TabDefinition[] = [];
  private activeTab = 0;
  private settingsList: SettingsList | null = null;
  /**
   * The pi-tui SettingsList keeps selectedIndex/filteredItems/maxVisible/submenuComponent
   * private, but this modal reads/writes them to drive tab layout. This structural type
   * names exactly which internals are accessed (no blanket any).
   */
  private get listInternals(): {
    selectedIndex: number;
    filteredItems: SettingItem[] | undefined;
    maxVisible: number;
    submenuComponent: unknown;
  } {
    return this.settingsList as unknown as {
      selectedIndex: number;
      filteredItems: SettingItem[] | undefined;
      maxVisible: number;
      submenuComponent: unknown;
    };
  }
  private container!: Container;
  private contentBox!: Box;
  /** Persistent modal-owned filter field. Created ONCE in the constructor and re-added to
   *  `container` on each `rebuildContent` (so its text survives per-keystroke / per-tab-switch
   *  rebuilds — the list is rebuilt, the filter Input is not). */
  private filterInput: Input;
  /** The items currently shown (after applying the live filter). `SettingsList.selectedIndex`
   *  indexes THIS array, so Up/Down selection must resolve against it — not the unfiltered set. */
  private currentVisibleItems: SettingItem[] = [];
  private theme: Theme;
  private onChange: (id: string, value: unknown) => void;
  private onClose: () => void;
  private enableSearch: boolean;
  private tui?: { terminal?: { rows?: number } };
  private selectedItem: SettingItem | null = null;
  private descriptions: Map<string, string> = new Map();
  private fixedMaxVisible!: number;
  /** Max rows the value-picker dropdown may show (terminal-capped). Kept independent of
   *  fixedMaxVisible because a setting's presets (e.g. a model list) can outnumber its tab's
   *  items many times over. */
  private pickerMaxRows!: number;
  /** Rows reserved for the shared list/picker slot = max(fixedMaxVisible, pickerMaxRows). The
   *  modal always pads to this height so opening the dropdown never grows or shifts the modal. */
  private listAreaRows!: number;
  private maxTabItems!: number;
  private getDescriptionFn: (id: string) => string | undefined;

  constructor(options: TabSettingsOptions, theme: Theme, tui: { terminal?: { rows?: number } } | undefined) {
    this.buildTabsFn = options.buildTabs;
    this.theme = theme;
    this.onChange = options.onChange;
    this.onClose = options.onClose;
    this.enableSearch = options.enableSearch ?? true;
    this.tui = tui;
    this.getDescriptionFn = options.getDescription ?? (() => undefined);

    const tabs = this.buildTabsFn();

    this.maxTabItems = Math.max(3, ...tabs.map((t) => t.settings.length));
    this.recomputeFixedMaxVisible();

    this.refreshTabs(tabs);

    // Stable fields created ONCE (not in rebuildContent): the container (so its children aren't
    // blown away each rebuild) and the filter Input (so its text/state survives rebuilds).
    this.container = new Container();
    this.filterInput = new Input();
    this.filterInput.focused = true;

    this.rebuildContent(tabs, EMPTY_FILTER);
  }

  /** Recompute fixedMaxVisible from current terminal height and maxTabItems (capped ≥3). */
  private recomputeFixedMaxVisible(): void {
    const rows = this.tui?.terminal?.rows ?? process.stdout.rows ?? 24;
    const computed = rows - SETTINGS_DIALOG_OVERHEAD;
    this.fixedMaxVisible = Math.min(this.maxTabItems, Math.max(3, computed));
    // The picker can legitimately need more rows than the list (a model setting may have many
    // presets while its tab has few items), so cap it independently — then reserve the larger of
    // the two for the shared list/picker slot. Opening the dropdown then never grows the modal.
    this.pickerMaxRows = Math.min(PICKER_VIEWPORT_MAX, Math.max(3, computed));
    this.listAreaRows = Math.max(this.fixedMaxVisible, this.pickerMaxRows);
  }

  /** Refresh the cached tabs and the invariant description index. Called whenever fresh tabs
   *  are built (open, tab switch, value edit) — NOT per filter keystroke. */
  private refreshTabs(tabs: TabDefinition[]): void {
    this.cachedTabs = tabs;
    this.descriptions.clear();
    for (const tab of tabs) {
      for (const item of tab.settings) {
        const desc = this.getDescriptionFn(item.id) ?? item.description;
        if (desc) {
          this.descriptions.set(item.id, desc);
        }
      }
    }
  }

  private rebuildContent(tabs: TabDefinition[], filterText: string): void {
    this.contentBox = new Box(0, 0);

    this.contentBox.addChild(new Text(this.renderTabBar(tabs), 0, 0));
    this.contentBox.addChild(new Spacer(1));

    // The active tab's full unfiltered items; filtered below into `visibleSettings`.
    const rawSettings = tabs[this.activeTab]?.settings ?? [];

    // Filter the cached items by a case-insensitive substring over label + current value.
    const needle = filterText.toLowerCase();
    const visibleSettings = needle
      ? rawSettings.filter((item) => {
          const haystack = `${item.label} ${item.displayValue ?? item.value ?? ""}`.toLowerCase();
          return haystack.includes(needle);
        })
      : rawSettings;
    // The SettingsList is built from this filtered array, so its selectedIndex indexes it —
    // store it for Up/Down resolution in handleInput.
    this.currentVisibleItems = visibleSettings;

    // Convert schema SettingItem to pi-tui SettingItem
    const activeSettings: TuiSettingItem[] = visibleSettings.map((item): TuiSettingItem => {
      const tuiItem: TuiSettingItem = {
        id: item.id,
        label: item.label,
        currentValue: item.displayValue ?? item.value ?? "",
        description: undefined, // rendered externally in fixed area
      };

      // Wire the ValuePicker submenu for settings with presets. All preset-backed
      // settings (enum, timeout, number) now flow through presets pairs → ValuePicker,
      // which already hides the misleading "Custom..." entry for closed-string-enums.
      if (item.presets && item.type) {
        const rawValue = item.value ?? "";
        const itemPresets = item.presets;
        const itemType = item.type;
        tuiItem.submenu = (_currentValue, done) => {
          return new ValuePickerSubmenu(
            itemPresets,
            rawValue,
            itemType,
            this.theme,
            (selectedValue) => {
              if (selectedValue !== undefined) {
                this.onChange(item.id, selectedValue);
              }
              done(); // tell SettingsList submenu is closed; don't pass a value to avoid a second onChange with serialized string
            },
            this.pickerMaxRows,
          );
        };
      }

      return tuiItem;
    });

    this.settingsList = new SettingsList(
      activeSettings,
      this.fixedMaxVisible,
      getSettingsListTheme(),
      // SettingsList fires this for inline value-cycling (settings without a submenu).
      // This modal routes all edits through submenus (which call onChange directly above
      // with the raw value, then invoke done() with no args), so this callback is unused.
      (_id: string, _newValue: string) => {},
      () => this.onClose(),
      { enableSearch: this.enableSearch },
    );
    this.contentBox.addChild(this.settingsList);

    // Rebuild only the container's children (do NOT recreate `this.container`): re-add the
    // persistent filter Input ABOVE the content box, then the content box. Since `container` is
    // stable and `filterInput` is re-added (not recreated), filter text/state survives the
    // per-keystroke / per-tab-switch rebuild. This is the only renderable home that survives.
    this.container.clear();
    this.container.addChild(this.filterInput);
    this.container.addChild(this.contentBox);

    this.selectedItem = visibleSettings[0] ?? null;
  }

  private renderTabBar(tabs: TabDefinition[]): string {
    const t = this.theme;
    const parts: string[] = [" "];
    for (let i = 0; i < tabs.length; i++) {
      const isActive = i === this.activeTab;
      const label = ` ${tabs[i].label} `;
      if (isActive) {
        parts.push(t.bg("selectedBg", t.fg("text", label)));
      } else {
        parts.push(t.fg("muted", label));
      }
    }
    return parts.join("");
  }

  switchTab(dir: number): void {
    const tabs = this.buildTabsFn();
    this.activeTab = (this.activeTab + dir + tabs.length) % tabs.length;
    this.refreshTabs(tabs);
    // Thread the live filter so it persists across tab switches (otherwise the filter silently
    // clears on each switch).
    this.rebuildContent(tabs, this.filterInput.getValue());
  }

  syncActiveTab(): void {
    if (!this.settingsList) return;
    const tabs = this.buildTabsFn();
    this.refreshTabs(tabs); // refresh cachedTabs + descriptions so the next filter keystroke sees the edited values
    const activeSettings = tabs[this.activeTab]?.settings ?? [];
    for (const item of activeSettings) {
      this.settingsList.updateValue(item.id, item.displayValue ?? item.value ?? "");
    }
    const idx = this.listInternals.selectedIndex ?? 0;
    const items = this.listInternals.filteredItems;
    this.selectedItem = items?.[idx] ?? activeSettings[idx] ?? null;
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);

    this.recomputeFixedMaxVisible();
    if (this.settingsList) this.listInternals.maxVisible = this.fixedMaxVisible;

    let lines: string[];
    try {
      lines = this.container.render(safeWidth);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [this.theme.fg("error", `Settings render error: ${message}`)];
    }

    const preListLines = 3;
    const hintLineCount = 2;
    const descSpacer = 1;
    const descLineCount = 3;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line?.includes("Esc to cancel")) {
        // Re-label the close hint, and drop the now-false "Space" change key (Space is a filter
        // character in the filter-first model — only Enter opens the picker).
        lines[i] = line
          .replace("Enter/Space to change", "Enter to change")
          .replace("Esc to cancel", "Esc to save for session and close");
      }
    }

    // Pad the list/picker slot to its reserved height BEFORE the description, so the description
    // stays pinned at a fixed line whether the (shorter) list or the (taller) picker is rendering.
    // Padding only at the end would let the description slide down when the dropdown opens.
    const slotEnd = preListLines + this.listAreaRows + hintLineCount;
    while (lines.length < slotEnd) {
      lines.push("");
    }

    lines.push("");

    // Render the description for the selected item, kept visible even while a value-picker
    // dropdown is open. Opening the dropdown does not move the selection, so this.selectedItem
    // still points at the item that opened it — the user keeps context on what they are editing.
    if (this.selectedItem) {
      const desc = this.descriptions.get(this.selectedItem.id);
      const wrappedDesc = desc ? wrapTextWithAnsi(desc, safeWidth - 4) : [];
      for (let i = 0; i < descLineCount; i++) {
        if (i < wrappedDesc.length) {
          if (i === 2 && wrappedDesc.length > 3) {
            const line = wrappedDesc[2];
            lines.push(line.length > safeWidth - 4 ? `${line.slice(0, safeWidth - 4)}…` : line);
          } else {
            lines.push(wrappedDesc[i]);
          }
        } else {
          lines.push("");
        }
      }
    } else {
      for (let i = 0; i < descLineCount; i++) lines.push("");
    }

    const targetTotalLines = preListLines + this.listAreaRows + hintLineCount + descSpacer + descLineCount;
    while (lines.length < targetTotalLines) {
      lines.push("");
    }

    return lines;
  }

  invalidate(): void {
    this.container.invalidate();
  }

  handleInput(data: string): void {
    // State-aware routing: when the value-picker submenu is open, the modal does not intercept
    // keys — everything is delegated to the list/picker so Tab/Left/Right never reach switchTab
    // while picking.
    if (this.settingsList && this.listInternals.submenuComponent) {
      this.settingsList.handleInput(data);
      return;
    }

    // Tab / Shift+Tab switch tabs. Verified feasible: pi-tui Input.handleInput does not consume
    // Tab (only the Editor component does), and the settings overlay is a capturing modal.
    if (matchesKey(data, Key.tab)) {
      this.switchTab(1);
      return;
    }
    if (matchesKey(data, Key.shift("tab"))) {
      this.switchTab(-1);
      return;
    }

    // Left/Right move the text cursor inside the filter field (reassigned from tab switching to
    // filter-cursor movement, mirroring pi's /settings).
    if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
      this.filterInput.handleInput(data);
      return;
    }

    // Arrow Up/Down move selection; Enter opens the value picker. These go to the SettingsList.
    if (matchesKey(data, Key.up) || matchesKey(data, Key.down) || matchesKey(data, Key.enter)) {
      const prevIndex = this.settingsList ? this.listInternals.selectedIndex : -1;
      this.settingsList?.handleInput(data);
      const newIndex = this.settingsList ? this.listInternals.selectedIndex : -1;
      if (newIndex !== prevIndex && this.settingsList) {
        const item = this.currentVisibleItems[newIndex] ?? this.currentVisibleItems[0] ?? null;
        if (item) {
          this.selectedItem = item;
        }
      }
      return;
    }

    // Esc / Ctrl+C close the modal (Ctrl+C mirrors pi-tui's select.cancel = [escape, ctrl+c];
    // without this, Ctrl+C falls to the filter default-sink where Input intercepts it as cancel
    // but onEscape is unset, so the modal would not close).
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onClose();
      return;
    }

    // Default sink: everything else (editing keys — Backspace, Delete, word-delete (Ctrl+W),
    // line-clear (Ctrl+U) — and any other unhandled keystroke) feeds the filter field. Never route
    // these to settingsList.handleInput, which would no-op them and silently break filter editing.
    // Reuse the cached tabs (NOT buildTabsFn) — buildSchemaTabGroups must not re-run per keystroke.
    // Only rebuild when the filter text actually changed: a no-op keystroke (Backspace on an empty
    // filter, cursor movement) must not reset the list selection to item 0. Mirrors the value picker.
    const before = this.filterInput.getValue();
    this.filterInput.handleInput(data);
    if (this.filterInput.getValue() !== before) {
      this.rebuildContent(this.cachedTabs, this.filterInput.getValue());
    }
  }
}
