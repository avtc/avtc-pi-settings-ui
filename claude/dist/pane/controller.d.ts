import type { PresetItem, SettingItem, SettingsSchema, TabDefinition } from "../schema.js";
/** The host-side surface the controller notifies (a dim line per message). */
export interface PaneNotify {
    message: (text: string) => void;
    warn: (text: string) => void;
}
/** The storage levels a pane offers save actions for (inherited from the handle). */
export type PaneStorageLevels = ReadonlyArray<"session" | "project" | "global">;
/** What the controller's handle must provide (the factory's product). */
export interface PaneHandle {
    getSettings(): Record<string, unknown>;
    updateSetting(key: string, value: unknown): void;
    persistToGlobal(): Promise<void>;
    persistToProject(cwd?: string): Promise<void>;
    /** The schema the groups build from (the factory's product carries it). */
    schema: SettingsSchema;
}
export interface PaneControllerOptions {
    title: string;
    notify: PaneNotify;
    storageLevels: PaneStorageLevels;
    /** The cwd project saves target (the host passes the session cwd). */
    cwd?: string;
    /** The host's close action (wired to its pane-close call). */
    onClose?: () => void;
    /** The host's picker-return action (Back or Esc): receives the row id so
     *  the host can put the focus ring back on that row (pi returns to the
     *  item it was changing). */
    onPickerClosed?: (rowId: string) => void;
    /** The host's repaint action — fired after every state change so the pane redraws. */
    onInvalidate?: () => void;
}
export interface PaneState {
    title: string;
    tabs: TabDefinition[];
    activeTabIndex: number;
    dirty: boolean;
    storageLevels: PaneStorageLevels;
    /** The live filter text (pi's always-active filter field above the tab bar). */
    filterText: string;
    /** Bumped on every filter SUBMIT (a fresh element is keyed on it — the engine clears a submitted field's internal text). */
    filterEpoch: number;
    /** The active tab's settings after the filter (what the rows show). */
    visibleSettings: SettingItem[];
    /** The row whose description the bottom box shows (last touched, else the first visible). */
    describedRow: SettingItem | null;
    /** The row the focus ring last landed on (the → marker's row). In the
     *  input-anchored model this carries the INTERNAL selection instead. */
    ringRowId: string | null;
    /** The input-anchored model's active row (undefined in the ring model). */
    selectionId: string | null;
    /** The input-anchored model's active picker option index (undefined in
     *  the ring model). */
    pickerSelection: number;
    /** The value picker's open row (pi: Enter opens the picker; Esc returns) — null = the settings list. */
    pickingRow: SettingItem | null;
    /** The picker's live filter over its options. */
    pickerFilter: string;
    /** The picker filter's submit epoch (same fresh-element rule as filterEpoch). */
    pickerEpoch: number;
    /** The picking row's options after its filter. */
    pickerOptions: PresetItem[];
}
export declare function createPaneController(handle: PaneHandle, options: PaneControllerOptions): {
    handle: PaneHandle;
    state: () => PaneState;
    prepare: () => Promise<void>;
    switchTab: (index: number) => void;
    pageTurn: (delta: 1 | -1) => void;
    pageTurnDirect: (delta: 1 | -1) => void;
    setFilter: (text: string) => void;
    submitFilter: (text: string) => void;
    setPickerFilter: (text: string) => void;
    submitPickerFilter: (text: string) => void;
    setDescribedFromKey: (key: string) => void;
    isRingOnRow: () => boolean;
    anchorMove: (delta: 1 | -1) => void;
    anchorEnter: () => void;
    anchorFocusAttempt: (targetKey: string | null) => "allow" | "deny" | `redirect:${string}`;
    anchorSeatKey: () => string;
    openPicker: (id: string) => void;
    closePicker: () => void;
    pickPreset: (id: string, label: string) => void;
    submitCustom: (id: string, text: string) => void;
    selectValue: (id: string, displayValue: string) => void;
    submitText: (id: string, text: string) => void;
    toggle: (id: string) => void;
    persistProject: () => Promise<void>;
    persistGlobal: () => Promise<void>;
    close: () => void;
    setNotify(next: PaneNotify): void;
    setInvalidate(next: (() => void) | null): void;
    setCwd(next: string): void;
};
export type PaneController = ReturnType<typeof createPaneController>;
