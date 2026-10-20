// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * The pane tree builder — composes the settings pane's element tree from the
 * controller's state, using the element table the SURFACE hands out (passed
 * in as data; this module never touches a UI API).
 *
 * Layout (pi's modal shape on the pane's primitives): the filter field
 * first — always active, every keystroke narrows the rows — then the tab
 * row, the active tab's setting rows as a two-column table (label left,
 * value control right), a description box for the last-touched row (pi's
 * selected-row description area), and a footer (save actions + close).
 * Value controls follow the row's shape: booleans toggle by Button, preset
 * lists pick by Select, everything else edits by Input submit. The site's
 * focus ring walks the actables (Tab/arrows — the engine's traversal);
 * Enter acts on the focused control; Escape closes the pane.
 */

import type { PresetItem, SettingItem } from "../schema.js";
import { getTypeDefinition } from "../type-definitions.js";
import type { PaneController } from "./controller.js";

/** The element constructors a surface provides (the subset this tree uses). */
export interface PaneElements {
  Box: (props: Record<string, unknown>) => unknown;
  Text: (props: Record<string, unknown>) => unknown;
  Button: (props: Record<string, unknown>) => unknown;
  Input: (props: Record<string, unknown>) => unknown;
  Select: (props: Record<string, unknown>) => unknown;
}

export interface PaneTreeOptions {
  /** Cells available for the body (e.props.bodyColumns from the render envelope). */
  bodyColumns: number;
  /** A dirty marker in the footer (the unsaved-changes hint). */
  dirty?: boolean;
  /** The surface drawing the pane (e.surface). Keyboard-driven hints are
   *  drawn only on surfaces whose controls take the keyboard (the desktop
   *  drives the pane with the pointer). */
  surface?: string;
}

const TAB_KEY_PREFIX = "settings-tab-";
const PAGE_PREV_KEY = "settings-page-prev";
const PAGE_NEXT_KEY = "settings-page-next";
const CLOSE_KEY = "settings-close";
const SAVE_PROJECT_KEY = "settings-save-project";
const SAVE_GLOBAL_KEY = "settings-save-global";

const ACTIVE_TAB_MARKER = "▸";
const INACTIVE_TAB_MARKER = " ";

const SAVE_PROJECT_LABEL = "Save project";
const SAVE_GLOBAL_LABEL = "Save global";
const CLOSE_LABEL = "Close";
const DIRTY_MARKER = " (modified)";
const FILTER_KEY = "settings-filter";

/** The description box's line budget (pi's fixed three-line description area). */
const DESCRIPTION_LINES = 3;

/** The value control for one setting row: a value-Button, uniformly — the
 *  ring walks the rows (Tab/arrows), Enter opens the value picker (pi's
 *  Enter-to-change); no per-row dropdowns, so the layout never jumps. */
function settingControl(els: PaneElements, controller: PaneController, row: SettingItem): unknown {
  return els.Button({
    key: row.id,
    label: row.displayValue,
    plain: true,
    onPress: () => controller.openPicker(row.id),
  });
}

/** One setting row: the selection marker, the label left, the value control
 *  right — pi's two-column table (no zebra: pi's rows are uniform; the →
 *  marks the ring's row like pi's selection cursor). */
function settingRow(
  els: PaneElements,
  controller: PaneController,
  row: SettingItem,
  _index: number,
  labelWidth: number,
  ringRowId: string | null,
): unknown {
  const marker = ringRowId === row.id ? "→ " : "  ";
  return els.Box({
    key: `settings-row-${row.id}`,
    flexDirection: "row",
    columnGap: 1,
    children: [
      els.Text({
        // the padded label column needs the monospaced face on surfaces whose
        // UI face is proportional (the terminal ignores the prop)
        mono: true,
        children: [`${marker}${row.label.padEnd(labelWidth)}`],
        ...(ringRowId === row.id ? { color: "claude" } : {}),
      }),
      settingControl(els, controller, row),
    ],
  });
}

/** The description area: a FIXED line budget padded with empty rows (pi's
 *  reserved description slot — a long or short description never shifts
 *  anything below it). */
function descriptionBox(els: PaneElements, row: SettingItem | null, bodyColumns: number): unknown {
  const text = row === null ? "" : `${row.description ?? ""}`;
  const perLine = Math.max(20, bodyColumns - 2);
  const lines: string[] = [];
  for (let i = 0; i < text.length && lines.length < DESCRIPTION_LINES; i += perLine) {
    lines.push(text.slice(i, i + perLine));
  }
  while (lines.length < DESCRIPTION_LINES) lines.push("");
  return els.Text({ mono: true, children: [lines.join("\n")], dimColor: true });
}

/** The value picker (pi's filter-first picker): the picking row's title, a
 *  filter field, the filtered preset options as buttons, a custom-value
 *  entry, and a back action. Enter picks; Esc returns (the host's ui.close
 *  hook denies the pane close while picking). */
function pickerBody(
  els: PaneElements,
  controller: PaneController,
  options: PaneTreeOptions,
  pickingRow: SettingItem,
  pickerFilter: string,
  pickerEpoch: number,
  pickerOptions: PresetItem[],
): unknown {
  const inputMode = controller.state().selectionId !== undefined;
  const pickerSelection = controller.state().pickerSelection as number | undefined;
  const optionButtons = pickerOptions.map((preset, index) =>
    els.Button({
      key: `pick:${index}`,
      label: `${inputMode && pickerSelection === index ? "→ " : "  "}${preset.label}`,
      plain: true,
      ...(inputMode && pickerSelection === index ? { color: "claude" } : {}),
      onPress: () => controller.pickPreset(pickingRow.id, preset.label),
    }),
  );
  // custom entry only for open types (pi hides it for closed enums/models)
  // pi rule: custom entry for open types AND preset-less rows (a string with
  // presets is a closed enum; model/boolean are closed by their type)
  const presetless = pickingRow.presets === undefined || pickingRow.presets.length === 0;
  // the row's own merged verdict wins (the schema's per-setting override
  // over the type default — the owl's model row pairs presets with a
  // custom value field this way)
  const supportsCustom =
    presetless ||
    (pickingRow.supportsCustomValues ?? getTypeDefinition(pickingRow.type).supportsCustomValues) !== false;
  // A presetless row has no options to filter: the picker IS the custom
  // value input — drawn alone and focused immediately.
  const customOnly = presetless && supportsCustom;
  const children: unknown[] = [els.Text({ children: [pickingRow.label], bold: true })];
  if (!customOnly) {
    children.push(
      els.Input({
        key: `picker-filter:${pickerEpoch}`,
        placeholder: "filter",
        value: pickerFilter,
        autoFocus: true,
        onInput: (value: string) => controller.setPickerFilter(value),
        submitLabel: "",
        onSubmit: (value: string) => controller.submitPickerFilter(value),
      }),
      els.Box({ key: "picker-options", flexDirection: "column", children: optionButtons }),
    );
  }
  if (supportsCustom) {
    children.push(
      els.Input({
        key: "picker-custom",
        label: "Custom value…",
        ...(customOnly ? { autoFocus: true } : {}),
        submitLabel: "set",
        onSubmit: (value: string) => controller.submitCustom(pickingRow.id, value),
      }),
    );
  }
  children.push(
    els.Button({
      key: "picker-back",
      label: "← Back",
      onPress: () => controller.closePicker(),
    }),
    ...(options.surface === "desktop"
      ? []
      : [els.Text({ children: ["  Enter to select · Esc to go back"], dimColor: true })]),
    els.Text({ children: [" "] }),
    els.Box({
      key: "picker-description",
      flexDirection: "column",
      children: [descriptionBox(els, pickingRow, options.bodyColumns)],
    }),
  );
  return els.Box({
    key: "settings-picker",
    flexDirection: "column",
    rowGap: 0,
    children,
  });
}

export function buildPaneTree(els: PaneElements, controller: PaneController, options: PaneTreeOptions): unknown {
  const {
    title,
    tabs,
    activeTabIndex,
    dirty,
    storageLevels,
    filterText,
    filterEpoch,
    visibleSettings,
    describedRow,
    ringRowId,
    pickingRow,
    pickerFilter,
    pickerEpoch,
    pickerOptions,
  } = controller.state();

  if (pickingRow !== null) {
    return els.Box({
      key: "settings-pane-root",
      flexDirection: "column",
      rowGap: 0,
      borderStyle: "round",
      children: [
        els.Text({ children: [`${title}${dirty ? DIRTY_MARKER : ""}`], bold: true }),
        pickerBody(els, controller, options, pickingRow, pickerFilter, pickerEpoch, pickerOptions),
      ],
    });
  }

  const tabButtons = tabs.map((tab, index) =>
    els.Button({
      key: `${TAB_KEY_PREFIX}${index}`,
      label: `${index === activeTabIndex ? ACTIVE_TAB_MARKER : INACTIVE_TAB_MARKER} ${tab.label}`,
      dimColor: index !== activeTabIndex,
      // the first tab owns the pane's initial focus ring (a surface that
      // focuses the last actable drawn otherwise starts there)
      ...(index === 0 ? { autoFocus: true as const } : {}),
      onPress: () => controller.switchTab(index),
    }),
  );
  // The page chords' RECEIVERS, in the tab lane where page controls live:
  // the engine presses the Button carrying the bound action, so the
  // shipped ctrl+left / ctrl+right entries land here. Clickable too.
  tabButtons.push(
    els.Button({
      key: PAGE_PREV_KEY,
      label: "‹",
      plain: true,
      dimColor: true,
      action: "chat:undo",
      onPress: () => controller.pageTurnDirect(-1),
    }),
    els.Button({
      key: PAGE_NEXT_KEY,
      label: "›",
      plain: true,
      dimColor: true,
      action: "chat:newline",
      onPress: () => controller.pageTurnDirect(1),
    }),
  );
  const labelWidth = Math.max(...visibleSettings.map((row) => row.label.length), 1);
  const rows = visibleSettings.map((row, index) =>
    settingRow(
      els,
      controller,
      row,
      index,
      labelWidth,
      // the selection marker names the keyboard walk's seat; a pointer-driven
      // surface has no walk, and no hook follows its hover — the marker
      // would point at a row the pointer never chose
      options.surface === "desktop" ? null : ringRowId,
    ),
  );

  const footerActions: unknown[] = [];
  const liveSave = storageLevels.length === 1 && storageLevels[0] !== "session";
  if (!liveSave && storageLevels.includes("project")) {
    footerActions.push(
      els.Button({
        key: SAVE_PROJECT_KEY,
        label: SAVE_PROJECT_LABEL,
        // pi's settings-modal save key: while the pane holds the keyboard
        // the Chat context (chat:stash's owner) is inactive, so its chord
        // reaches this button instead
        action: "chat:stash",
        onPress: () => {
          void controller.persistProject();
        },
      }),
    );
  }
  if (!liveSave && storageLevels.includes("global")) {
    footerActions.push(
      els.Button({
        key: SAVE_GLOBAL_KEY,
        label: SAVE_GLOBAL_LABEL,
        // a composer-text action token — its engine handler lives at the
        // composer, unmounted while the pane holds the keyboard, so the
        // shipped ctrl+g chord reaches this button (the key is pane-bound
        // only; its real meaning never fires)
        action: "chat:clearInput",
        onPress: () => {
          void controller.persistGlobal();
        },
      }),
    );
  }
  footerActions.push(
    els.Button({
      key: CLOSE_KEY,
      label: CLOSE_LABEL,
      onPress: () => controller.close(),
    }),
  );

  return els.Box({
    key: "settings-pane-root",
    flexDirection: "column",
    rowGap: 0,
    borderStyle: "round",
    children: [
      els.Text({ children: [`${title}${dirty ? DIRTY_MARKER : ""}`], bold: true }),
      els.Input({
        key: `${FILTER_KEY}:${filterEpoch}`,
        placeholder: "filter",
        value: filterText,
        autoFocus: true,
        onInput: (value: string) => controller.setFilter(value),
        // Enter applies the filter; a submit consumes the field's internal
        // text, so the epoch keys a FRESH element on the next draw and the
        // live value is redrawn — the field never blanks
        submitLabel: "",
        onSubmit: (value: string) => controller.submitFilter(value),
      }),
      els.Box({ key: "settings-tabs", flexDirection: "row", columnGap: 1, children: tabButtons }),
      els.Text({ children: [" "] }),
      els.Box({ key: "settings-rows", flexDirection: "column", children: rows }),
      els.Text({ children: [" "] }),
      els.Text({ children: ["  Enter to change · Esc to close"], dimColor: true }),
      els.Text({ children: [" "] }),
      els.Box({
        key: "settings-description",
        flexDirection: "column",
        children: [descriptionBox(els, describedRow, options.bodyColumns)],
      }),
      els.Box({ key: "settings-footer", flexDirection: "row", columnGap: 1, children: footerActions }),
      // The keybind legend (pi-style footer note) — only where the keyboard
      // drives the pane; pointer-driven surfaces draw nothing
      ...(options.surface === "desktop"
        ? []
        : [
            els.Box({
              key: "settings-legend",
              flexDirection: "row",
              children: [
                els.Text({
                  children: [
                    "  Esc | ↑↓: navigate | ←→: filter cursor | Ctrl+←/→: switch tab | Enter: change | Ctrl+S: save project | Ctrl+G: save global",
                  ],
                  dimColor: true,
                }),
              ],
            }),
          ]),
    ],
  });
}
