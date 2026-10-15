// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * The settings pane controller — the interaction model behind the pane a host
 * opens with `$.ui.open` and draws through its `ui.render` Pane hook.
 *
 * The controller owns NO surface: hosts and tests reach it as data (tab
 * state, rows, actions). Element constructors arrive as a table at tree-build
 * time (the band pattern — the surface's own elements, passed in), so this
 * module never touches a UI API and joins any hooks closure cleanly.
 */

import { resolveFunctionPresets } from "../preset-resolver.js";
import type { PresetItem, SettingItem, SettingsSchema, TabDefinition } from "../schema.js";
import { buildSchemaTabGroups } from "../schema-tabs.js";
import { getTypeDefinition } from "../type-definitions.js";

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

const PANE_NOTIFY_SAVED_PROJECT = "Settings saved to project.";
const PANE_NOTIFY_SAVED_GLOBAL = "Settings saved as global default.";
const PANE_NOTIFY_SAVE_FAILED = "Settings save failed.";

export function createPaneController(handle: PaneHandle, options: PaneControllerOptions) {
  const { title, storageLevels, onClose, onInvalidate } = options;
  // The stateless single-file mode (one file level, no session): every
  // change writes through immediately — no dirty marker, no save actions.
  const liveSave = storageLevels.length === 1 && storageLevels[0] !== "session";
  let invalidate: (() => void) | null = onInvalidate ?? null;

  /** The repaint request after a state change (a no-op until the host wires one). */
  function requestRepaint(): void {
    try {
      invalidate?.();
    } catch {
      // A repaint failure must never break an interaction.
    }
  }
  let notify: PaneNotify = options.notify;
  let cwd = options.cwd ?? "";
  let activeTabIndex = 0;
  let dirty = false;
  /** The live filter (pi's modal filter field): case-insensitive substring over label + description. */
  let filterText = "";
  /** The last-interacted row — its description fills the bottom box (pi's selected-row description area). */
  let lastTouchedId: string | null = null;
  /** The row the focus ring last landed on (the ui.focus hook reports ring moves). */
  let lastRingId: string | null = null;
  /** The open value picker's row id (pi: Enter opens the picker, Esc returns). */
  let pickingId: string | null = null;
  /** The picker's live filter over its options (pi's picker is filter-first). */
  let pickerFilter = "";
  /** The engine focus ring's logical seat (epoch-stripped): the input that
   *  holds the keyboard — the filter, or the picker's filter/custom field
   *  when the ring was allowed onto it. Proposals compare against THIS position. */
  let ringKey = "settings-filter";
  /** Submit epochs: a submitted field's internal text is consumed — the tree keys a fresh element on these. */
  let filterEpoch = 0;
  let pickerEpoch = 0;
  /** The input-anchored selection (the keyboard model: the filter Input holds
   *  the ring permanently; arrow/Tab ring-move attempts are denied and
   *  interpreted as item navigation; Enter arrives as the filter's submit —
   *  the engine routes typed characters to the composer when the ring sits
   *  on a non-Input element, so the anchored seat keeps every keystroke in
   *  the filter, pi's modal behavior). */
  let selectionId: string | null = null;
  let pickerSelection = 0;
  /** Presets resolved once at open (function sources — the live model list). */
  let resolvedPairs: Map<string, [string, string | null][]> | null = null;
  let tabs: TabDefinition[] = [];

  function rebuild(): void {
    const pairs = resolvedPairs ?? new Map<string, [string, string | null][]>();
    tabs = buildSchemaTabGroups(handle.getSettings(), handle.schema as never, pairs as never);
  }

  function matchesFilter(row: SettingItem): boolean {
    if (filterText === "") return true;
    const needle = filterText.toLowerCase();
    return row.label.toLowerCase().includes(needle) || (row.description ?? "").toLowerCase().includes(needle);
  }

  function state(): PaneState {
    const activeTab = tabs[activeTabIndex];
    const visibleSettings = (activeTab?.settings ?? []).filter(matchesFilter);
    // the SELECTION drives the description (pi's selected-row area tracks
    // the cursor); the last-touched row only seeds it until the first move
    // (the ring never leaves the filter field).
    const describedRow =
      visibleSettings.find((row) => row.id === selectionClamped()) ??
      visibleSettings.find((row) => row.id === lastTouchedId) ??
      visibleSettings[0] ??
      null;
    const pickingRow = pickingId !== null ? (findRow(pickingId) ?? null) : null;
    const pickerOptions =
      pickingRow?.presets?.filter(
        (preset) => pickerFilter === "" || preset.label.toLowerCase().includes(pickerFilter.toLowerCase()),
      ) ?? [];
    return {
      title,
      tabs,
      activeTabIndex,
      dirty,
      storageLevels,
      filterText,
      filterEpoch,
      visibleSettings,
      describedRow,
      ringRowId: selectionClamped(),
      selectionId: selectionClamped(),
      pickingRow,
      pickerFilter,
      pickerEpoch,
      pickerOptions,
      pickerSelection,
    };
  }

  /** The clamped selection: the nearest visible row at/after the current
   *  selection (a filter pass may hide it); null with no visible rows. */
  function selectionClamped(): string | null {
    const visible = (tabs[activeTabIndex]?.settings ?? []).filter(matchesFilter);
    if (visible.length === 0) return null;
    if (selectionId === null) return visible[0]?.id ?? null;
    const at = visible.findIndex((row) => row.id === selectionId);
    return at === -1 ? (visible[0]?.id ?? null) : selectionId;
  }

  /** The filter field's live text (pi: every keystroke narrows the rows). */
  function setFilter(text: string): void {
    filterText = text;
    requestRepaint();
  }

  /** The picker's live filter (pi's filter-first picker). */
  function setPickerFilter(text: string): void {
    pickerFilter = text;
    requestRepaint();
  }

  /** Enter on a filter field: the value applies (unchanged) and the epoch
   *  keys a fresh element — the engine cleared the submitted field's text.
   *  In the input-anchored model the filter field HAS no submit action of
   *  its own (pi's modal): Enter acts on the active row instead. */
  function submitFilter(text: string): void {
    filterText = text;
    filterEpoch += 1;
    requestRepaint();
    anchorEnter();
  }

  function submitPickerFilter(text: string): void {
    pickerFilter = text;
    pickerEpoch += 1;
    requestRepaint();
    anchorEnter();
  }

  /** Is the ring on one of our setting rows? (The host's focus-deny keeps
   *  the ring on rows only while it STARTED on one — a ring stranded on
   *  pane chrome by a vanished element must be allowed back.) */
  function isRingOnRow(): boolean {
    return lastRingId !== null && findRow(lastRingId) !== undefined;
  }

  /** The focus ring landed on a row (the ui.focus hook) — its description fills the bottom box. */
  function setDescribedFromKey(key: string): void {
    if (pickingId !== null) return;
    if (findRow(key) === undefined) return;
    if (lastRingId === key) return;
    lastRingId = key;
    requestRepaint();
  }

  /** Enter on a row: open the value picker for it (pi's Enter-to-change). */
  function openPicker(id: string): void {
    const row = findRow(id);
    if (row === undefined) return;
    pickingId = id;
    pickerFilter = "";
    pickerSelection = 0; // the walk starts at the first option
    // A presetless row has nothing to filter or walk: the custom value
    // input IS the picker — the field takes the ring directly.
    ringKey = pickerIsCustomOnly(row) ? "picker-custom" : "picker-filter";
    requestRepaint();
  }

  /** A row with no presets: its picker draws only the custom value input. */
  function pickerIsCustomOnly(row: SettingItem | undefined): boolean {
    return row?.presets === undefined || row.presets.length === 0;
  }

  /** The anchored seat's DRAWN key (epoch-suffixed) — what the host
   *  refocuses after a picker close; a stale epoch drops the keyboard out
   *  of the pane (the key is never drawn again). */
  function anchorSeatKey(): string {
    if (pickingId !== null) {
      return pickerIsCustomOnly(findRow(pickingId)) ? "picker-custom" : `picker-filter:${pickerEpoch}`;
    }
    return `settings-filter:${filterEpoch}`;
  }

  /** Leave the picker without changing anything (pi's Esc). */
  function closePicker(): void {
    if (pickingId === null) return;
    ringKey = "settings-filter"; // the seat returns with the picker
    const closed = pickingId;
    pickingId = null;
    pickerFilter = "";
    ringKey = "settings-filter"; // back to the pane's anchor seat
    requestRepaint();
    try {
      options.onPickerClosed?.(closed);
    } catch {
      // a host focus failure must never break the return
    }
  }

  /** Close the picker after a CHOICE and hand the ring back: the focused
   *  picker option element vanishes with the picker, and the engine's focus
   *  fallback lands on pane chrome (a tab button) — from there the arrows
   *  orbit chrome and the description (ring-driven) freezes. The host's
   *  onPickerClosed refocuses the edited row, the same as Esc/Back. */
  function closeAfterChoice(id: string): void {
    pickingId = null;
    pickerFilter = "";
    ringKey = "settings-filter"; // the seat returns with the picker
    requestRepaint();
    try {
      options.onPickerClosed?.(id);
    } catch {
      /* a host focus failure must never break the choice */
    }
  }

  /** Pick a preset option (pi's picker Enter). */
  function pickPreset(id: string, label: string): void {
    const row = findRow(id);
    const preset = row?.presets?.find((p) => p.label === label);
    if (!row || !preset) return;
    lastTouchedId = id;
    handle.updateSetting(id, preset.rawValue);
    markDirty();
    rebuild();
    closeAfterChoice(id);
  }

  /** Submit a custom value from the picker's entry row (pi's "Custom value…"). */
  function submitCustom(id: string, text: string): void {
    lastTouchedId = id;
    handle.updateSetting(id, text);
    markDirty();
    rebuild();
    closeAfterChoice(id);
  }

  /** Resolve function-presets once (the host calls this right after opening the pane). */
  async function prepare(): Promise<void> {
    const { pairs } = await resolveFunctionPresets(handle.schema as never);
    resolvedPairs = pairs as Map<string, [string, string | null][]>;
    rebuild();
  }

  function switchTab(index: number): void {
    if (index < 0 || index >= tabs.length) return;
    activeTabIndex = index;
    requestRepaint();
  }

  function markDirty(): void {
    // the stateless single-file mode saves live — there is no unsaved state
    if (liveSave) return;
    dirty = true;
  }

  /** A preset pick: map the display value back to its raw value through the gate. */
  function selectValue(id: string, displayValue: string): void {
    const row = findRow(id);
    if (!row?.presets) return;
    const preset = row.presets.find((p) => p.displayValue === displayValue);
    if (!preset) return;
    lastTouchedId = id;
    handle.updateSetting(id, preset.rawValue);
    markDirty();
    rebuild();
    requestRepaint();
  }

  /** A free-form submit: the raw text goes through the gate unchanged. */
  function submitText(id: string, text: string): void {
    lastTouchedId = id;
    handle.updateSetting(id, text);
    markDirty();
    rebuild();
    requestRepaint();
  }

  /** A boolean toggle: flip the current value through the gate. */
  function toggle(id: string): void {
    lastTouchedId = id;
    const current = handle.getSettings()[id];
    handle.updateSetting(id, typeof current === "boolean" ? !current : current);
    markDirty();
    rebuild();
    requestRepaint();
  }

  async function persistProject(): Promise<void> {
    try {
      await handle.persistToProject(cwd || undefined);
      dirty = false;
      notify.message(PANE_NOTIFY_SAVED_PROJECT);
    } catch {
      notify.warn(PANE_NOTIFY_SAVE_FAILED);
    }
  }

  async function persistGlobal(): Promise<void> {
    try {
      await handle.persistToGlobal();
      dirty = false;
      notify.message(PANE_NOTIFY_SAVED_GLOBAL);
    } catch {
      notify.warn(PANE_NOTIFY_SAVE_FAILED);
    }
  }

  /** The Close action: delegates to the host's wired close. */
  function close(): void {
    onClose?.();
  }

  function findRow(id: string) {
    for (const tab of tabs) {
      const row = tab.settings.find((s) => s.id === id);
      if (row) return row;
    }
    return undefined;
  }

  rebuild();

  // --- the input-anchored keyboard model --------------------------------
  // The filter Input holds the ring; every person-origin ring-move attempt
  // onto anything else is DENIED by the host and interpreted here as
  // navigation; Enter arrives as the filter's submit.

  /** Advance the internal selection over the visible rows. The walk stops
   *  at the picker's edges (nothing beyond its first/last option); on the
   *  settings pages it turns the PAGE at the row edges (continuing onto
   *  the neighbouring page, cycling over the tab ring). */
  function anchorMove(delta: 1 | -1): void {
    if (pickingId !== null) {
      const count = pickerOptionsCount();
      if (count === 0) return;
      const next2 = pickerSelection + delta;
      if (next2 < 0 || next2 >= count) return; // the picker's walk stops at its edges
      pickerSelection = next2;
      requestRepaint();
      return;
    }
    const visible = (tabs[activeTabIndex]?.settings ?? []).filter(matchesFilter);
    if (visible.length === 0) {
      selectionId = null;
      requestRepaint();
      return;
    }
    const current = selectionClamped();
    const at = visible.findIndex((row) => row.id === current);
    const next2 = at + delta;
    if (next2 < 0 || next2 >= visible.length) {
      pageTurn(delta); // the walk fell off the page — continue onto the neighbour
      return;
    }
    selectionId = visible[next2]?.id ?? null;
    requestRepaint();
  }

  /** The row walk fell off the page's first/last row: continue the walk on
   *  the neighbouring page (cycling over the tab ring) — Down off the
   *  bottom lands on the next page's first row, Up off the top on the
   *  previous page's last. */
  function pageTurn(delta: 1 | -1): void {
    turnPage(delta, delta === 1 ? "first" : "last");
  }

  /** A DIRECT page command (the chord receivers): the landed page starts
   *  at its FIRST row regardless of direction — a jump, not a walk. */
  function pageTurnDirect(delta: 1 | -1): void {
    turnPage(delta, "first");
  }

  function turnPage(delta: 1 | -1, land: "first" | "last"): void {
    if (tabs.length === 0) return;
    if (pickingId !== null) return; // the picker owns the pane — pages stay put
    const target = (activeTabIndex + delta + tabs.length) % tabs.length;
    activeTabIndex = target;
    const visible = (tabs[target]?.settings ?? []).filter(matchesFilter);
    selectionId =
      land === "first"
        ? (visible[0]?.id ?? null)
        : visible.length > 0
          ? (visible[visible.length - 1]?.id ?? null)
          : null;
    requestRepaint();
  }

  /** The picker's current option count (the filtered presets). */
  function pickerOptionsCount(): number {
    const row = pickingId !== null ? findRow(pickingId) : undefined;
    return (
      row?.presets?.filter(
        (preset) => pickerFilter === "" || preset.label.toLowerCase().includes(pickerFilter.toLowerCase()),
      )?.length ?? 0
    );
  }

  /** Enter in the anchored model: choose the active picker option when the
   *  picker is open; else open the active row's picker (pi's
   *  Enter-to-change — the filter field has no submit action of its own). */
  function anchorEnter(): void {
    if (pickingId !== null) {
      const row = findRow(pickingId);
      const options2 =
        row?.presets?.filter(
          (preset) => pickerFilter === "" || preset.label.toLowerCase().includes(pickerFilter.toLowerCase()),
        ) ?? [];
      const choice = options2[Math.max(0, Math.min(pickerSelection, options2.length - 1))];
      if (row && choice) pickPreset(row.id, choice.label);
      return;
    }
    const active = selectionClamped();
    if (active !== null) openPicker(active);
  }

  /** The pane's focusable sequence as the engine walks it (the tree's
   *  order): the ring holder's position in it decides a proposal's
   *  direction. Main pane: filter, tabs, visible rows, footer. Picker:
   *  filter, options, the custom field (when the type supports it), back. */
  function focusSequence(): string[] {
    if (pickingId !== null) {
      if (pickerIsCustomOnly(findRow(pickingId))) return ["picker-custom", "picker-back"];
      const seq = ["picker-filter"];
      for (let i = 0; i < pickerOptionsCount(); i += 1) seq.push(`pick:${i}`);
      if (customFieldInSequence()) seq.push("picker-custom");
      seq.push("picker-back");
      return seq;
    }
    const seq = ["settings-filter"];
    for (let index = 0; index < tabs.length; index += 1) seq.push(`settings-tab-${index}`);
    seq.push("settings-page-prev", "settings-page-next"); // the tab lane's receivers
    for (const row of (tabs[activeTabIndex]?.settings ?? []).filter(matchesFilter)) seq.push(row.id);
    seq.push("settings-save-project", "settings-save-global", "settings-close");
    return seq;
  }

  /** Interpret an offered ring move (the host's ui.focus hook). The engine
   *  names only the TARGET — no key identity — so direction comes from the
   *  target's POSITION against the ring's seat: our text inputs take the
   *  ring (typing must land in a field); anything else is denied and walks
   *  the selection — a target AFTER the seat walks down (Down and Tab
   *  propose the next focusable), BEFORE it or the engine's own stop above
   *  it walks up (Up and Shift+Tab). The picker's bottom edge answers
   *  "redirect:picker-custom": the host lands the ring on the custom value
   *  field so typing reaches it (the engine never proposes it — the ring
   *  never advances past the anchored seat on its own). */
  function anchorFocusAttempt(targetKey: string | null): "allow" | "deny" | `redirect:${string}` {
    if (ringKey === "picker-custom") {
      // the custom field keeps printables, Enter (submits the value) and
      // Esc (closes the picker); ANY focus proposal — the arrows, the
      // engine's stop above — hands the keyboard BACK to the anchored
      // filter (the field is a one-way excursion, never a trap)
      if (pickingId !== null && pickerIsCustomOnly(findRow(pickingId))) return "deny";
      ringKey = "picker-filter";
      return `redirect:picker-filter:${pickerEpoch}`;
    }
    if (targetKey === null) {
      anchorMove(-1); // nothing of ours above the seat — Up / Shift+Tab
      return "deny";
    }
    const seat = targetKey.split(":")[0];
    if (seat === "settings-filter" || seat === "picker-filter") {
      ringKey = seat;
      return "allow";
    }
    if (targetKey === "picker-custom") {
      if (!customFieldInSequence()) return "deny"; // not drawn — a closed-enum row
      ringKey = "picker-custom";
      return "allow";
    }
    const seq = focusSequence();
    const target = seq.indexOf(
      targetKey.startsWith("settings-row-") ? targetKey.slice("settings-row-".length) : targetKey,
    );
    const seatIdx = Math.max(0, seq.indexOf(ringKey));
    // Direction by SHORTEST signed distance on the cyclic sequence: some
    // engine builds' focus ring WRAPS (Up at the top proposes the LAST
    // focusable), which raw position math would read as "below the seat"
    // and walk DOWN for Up. A distance past half the sequence is a wrap.
    const raw = target - seatIdx;
    const half = seq.length / 2;
    const delta: 1 | -1 = raw > half ? -1 : raw < -half ? 1 : raw > 0 ? 1 : -1;
    // the picker's bottom edge hands the keyboard to the custom value field
    if (delta === 1 && pickingId !== null && pickerSelection >= pickerOptionsCount() - 1 && customFieldInSequence()) {
      ringKey = "picker-custom";
      return "redirect:picker-custom";
    }
    anchorMove(delta);
    return "deny";
  }

  /** Does the open picker draw a custom value field? (A presetless row
   *  always does; otherwise the row's merged verdict — the schema's
   *  per-setting override over the type default — decides.) */
  function customFieldInSequence(): boolean {
    if (pickingId === null) return false;
    const row = findRow(pickingId);
    const presetless = row?.presets === undefined || (row?.presets?.length ?? 0) === 0;
    return (
      presetless ||
      (row?.supportsCustomValues ?? getTypeDefinition(row?.type ?? "string").supportsCustomValues) !== false
    );
  }

  return {
    handle,
    state,
    prepare,
    switchTab,
    pageTurn,
    pageTurnDirect,
    setFilter,
    submitFilter,
    setPickerFilter,
    submitPickerFilter,
    setDescribedFromKey,
    isRingOnRow,
    anchorMove,
    anchorEnter,
    anchorFocusAttempt,
    anchorSeatKey,
    openPicker,
    closePicker,
    pickPreset,
    submitCustom,
    selectValue,
    submitText,
    toggle,
    persistProject,
    persistGlobal,
    close,
    setNotify(next: PaneNotify) {
      notify = next;
    },
    setInvalidate(next: (() => void) | null) {
      invalidate = next;
    },
    setCwd(next: string) {
      cwd = next;
    },
  };
}

export type PaneController = ReturnType<typeof createPaneController>;
