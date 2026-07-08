// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Shared helpers for the picker submenus (enum-picker, value-picker).
 *
 * Both pickers use the same cursor up/down wrap-around navigation and the
 * same line-building loop; extracting these keeps them in sync.
 */

/** Move `index` by `delta` (−1 up, +1 down) within a list of `length` entries,
 * wrapping at both ends. Returns the new index.
 */
export function wrapIndex(index: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  return (index + delta + length) % length;
}

/** Cursor step deltas for wrapIndex(): up = previous, down = next. */
const STEP_UP = -1;
const STEP_DOWN = 1;

/** Compute the visible window for a centered scrolling viewport (mirrors pi-tui's SelectList:
 *  the selection stays centered until it nears the top/bottom, then the window pins to that edge).
 *  Returns `{ start, end }` (half-open) clamped to `[0, length]`. When `length <= maxVisible` the
 *  whole list fits and `{ start: 0, end: length }` is returned. */
export function computeViewport(
  selectedIndex: number,
  length: number,
  maxVisible: number,
): { start: number; end: number } {
  if (length <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), length - maxVisible));
  const end = Math.min(start + maxVisible, length);
  return { start, end };
}

/** Build a single picker line: cursor prefix (or 2-space indent) + the themed label (selected vs unselected). */
export function renderPickerLine(
  isSelected: boolean,
  theme: { cursor: string },
  selectedLabel: string,
  unselectedLabel: string,
): string {
  const prefix = isSelected ? theme.cursor : "  ";
  const label = isSelected ? selectedLabel : unselectedLabel;
  return prefix + label;
}

/** Keybinding shape used by handlePickerNavigation (subset of pi-tui KeybindingsManager). */
interface KeybindingMatcher {
  matches(data: string, action: string): boolean;
}

/**
 * Handle cursor up/down navigation for a picker. Returns the new wrapped index when an up/down key
 * is matched, or `undefined` when the input is not a navigation key (caller handles confirm/cancel/etc).
 */
export function handlePickerNavigation(
  kb: KeybindingMatcher,
  data: string,
  selectedIndex: number,
  length: number,
): number | undefined {
  if (kb.matches(data, "tui.select.up")) return wrapIndex(selectedIndex, length, STEP_UP);
  if (kb.matches(data, "tui.select.down")) return wrapIndex(selectedIndex, length, STEP_DOWN);
  return undefined;
}
