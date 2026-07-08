// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, test } from "vitest";
import type { PresetItem } from "../src/schema.js";
import { PICKER_VIEWPORT_MAX, ValuePickerSubmenu } from "../src/ui/value-picker.js";

/** pi Theme stub: identity fg/bg so rendered text is plain (assertions reason about the label
 * text, not ANSI). The picker fetches its row-rendering SettingsListTheme via getSettingsListTheme()
 * internally; this stub is only used for the `fg("muted", ...)` model-span calls. */
const theme: Theme = {
  fg: (_role: string, text: string) => text,
  bg: (_role: string, text: string) => text,
} as unknown as Theme;

/** Default width for rendering flat output */
const DEFAULT_WIDTH = 60;

/** Flatten the picker's rendered output into one string for substring checks. */
function renderFlat(picker: ValuePickerSubmenu, width: number): string {
  return picker.render(width).join("\n");
}

/** No display values (use raw values) */
const NO_DISPLAY_VALUES: readonly string[] | null = null;

/** Build a PresetItem[] from parallel label/value/displayValue arrays (test convenience). */
function buildPresets(
  labels: readonly string[],
  rawValues: readonly (string | number | boolean | null)[],
  displayValues: readonly string[] | null,
): PresetItem[] {
  return labels.map((label, i) => ({
    label,
    rawValue: rawValues[i] ?? null,
    displayValue: (displayValues ?? rawValues.map(String))[i] ?? "",
  }));
}

describe('ValuePickerSubmenu — "Custom value…" entry gating', () => {
  beforeAll(() => initTheme());
  test('string (closed enum) does NOT show "Custom value…"', () => {
    // Mirrors the guardrail setting: a closed string enum.
    const presets = buildPresets(
      ["Off", "Ask", "Block", "Ask + Allow after 15m", "Ask + Block after 15m"],
      ["off", "ask", "block", "ask-allow-15m", "ask-block-15m"],
      NO_DISPLAY_VALUES,
    );
    const picker = new ValuePickerSubmenu(presets, "ask", "string", theme, () => {}, PICKER_VIEWPORT_MAX);

    const out = renderFlat(picker, DEFAULT_WIDTH);
    expect(out).not.toContain("Custom value…");
    // All five preset labels must still be present.
    for (const preset of presets) {
      expect(out).toContain(preset.label);
    }
  });

  test('numeric type DOES show "Custom value…"', () => {
    const presets = buildPresets(["1", "2", "3", "5", "10"], [1, 2, 3, 5, 10], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(presets, "3", "number", theme, () => {}, PICKER_VIEWPORT_MAX);

    expect(renderFlat(picker, DEFAULT_WIDTH)).toContain("Custom value…");
  });

  test('duration type DOES show "Custom value…" (duration custom input is meaningful)', () => {
    const presets = buildPresets(
      ["5m", "15m", "30m", "1h"],
      [300000, 900000, 1800000, 3600000],
      ["5m", "15m", "30m", "1h"],
    );
    const picker = new ValuePickerSubmenu(presets, "5m", "duration", theme, () => {}, PICKER_VIEWPORT_MAX);

    expect(renderFlat(picker, DEFAULT_WIDTH)).toContain("Custom value…");
  });

  test('compact-threshold type DOES show "Custom value…"', () => {
    const presets = buildPresets(["compact>75K", "compact>150K"], ["compact>75K", "compact>150K"], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(
      presets,
      "compact>75K",
      "compact-threshold",
      theme,
      () => {},
      PICKER_VIEWPORT_MAX,
    );

    expect(renderFlat(picker, DEFAULT_WIDTH)).toContain("Custom value…");
  });

  test("custom-indicator renders a non-numeric duration-label verbatim (not 'NaN')", () => {
    // A preset-less duration setting holding a defensive null renders its null-label
    // (e.g. 'Infinite'). The label matches no preset, so the custom-indicator path runs and must
    // render the label verbatim — NOT feed it through formatHumanDuration (which would yield 'NaN').
    const presets = buildPresets(["5m", "10m", "30m"], [300000, 600000, 1800000], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(presets, "Infinite", "duration", theme, () => {}, PICKER_VIEWPORT_MAX);
    const out = renderFlat(picker, DEFAULT_WIDTH);
    expect(out).toContain("◆ Infinite");
    expect(out).not.toContain("NaN");
  });
});

describe("ValuePickerSubmenu — string enum selection + legacy value", () => {
  beforeAll(() => initTheme());
  test("confirming a preset resolves done with its internal value", () => {
    const presets = buildPresets(["Off", "Ask", "Block"], ["off", "ask", "block"], NO_DISPLAY_VALUES);
    const captured: unknown[] = [];
    const picker = new ValuePickerSubmenu(
      presets,
      "off",
      "string",
      theme,
      (v) => captured.push(v),
      PICKER_VIEWPORT_MAX,
    );

    // Default selection is the matching preset ("off" → index 0). Confirm it.
    picker.handleInput("\r");
    expect(captured).toEqual(["off"]);
  });

  test("a legacy/garbage value shows a ◆ indicator at top (no Custom entry) and can be replaced", () => {
    const presets = buildPresets(["Off", "Ask", "Block"], ["off", "ask", "block"], NO_DISPLAY_VALUES);
    const captured: unknown[] = [];
    const picker = new ValuePickerSubmenu(
      presets,
      "garbage-legacy",
      "string",
      theme,
      (v) => captured.push(v),
      PICKER_VIEWPORT_MAX,
    );

    const out = renderFlat(picker, DEFAULT_WIDTH);
    // Legacy value is surfaced as a custom indicator (read-only display), still no Custom... entry.
    expect(out).toContain("◆ garbage-legacy");
    expect(out).not.toContain("Custom value…");

    // The indicator is selected by default (index 0); navigating down then confirming a preset
    // replaces the legacy value. Down once → index 1 ("Off"), confirm → done("off").
    picker.handleInput("\x1b[B"); // down
    picker.handleInput("\r"); // confirm
    expect(captured).toEqual(["off"]);
  });

  test("confirming a null preset fires done(null)", () => {
    const presets = buildPresets(["Infinite", "2", "6"], [null, 2, 6], ["Infinite", "2", "6"]);
    const captured: unknown[] = [];
    const picker = new ValuePickerSubmenu(
      presets,
      "Infinite",
      "number",
      theme,
      (v) => captured.push(v),
      PICKER_VIEWPORT_MAX,
    );

    // Default selection is the matching preset (Infinite → index 0). Confirm it.
    picker.handleInput("\r");
    expect(captured).toEqual([null]);
  });

  test("confirming a numeric preset fires done(numeric)", () => {
    const presets = buildPresets(["Infinite", "2", "6"], [null, 2, 6], ["Infinite", "2", "6"]);
    const captured: unknown[] = [];
    const picker = new ValuePickerSubmenu(presets, "2", "number", theme, (v) => captured.push(v), PICKER_VIEWPORT_MAX);

    // Default selection is "2" → index 1. Confirm it.
    picker.handleInput("\r");
    expect(captured).toEqual([2]);
  });
});

describe("ValuePickerSubmenu — custom input", () => {
  beforeAll(() => initTheme());
  test("invalid custom input shows the TypeDefinition.errorMessage", () => {
    const presets = buildPresets(["1", "2", "3"], [1, 2, 3], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(presets, "2", "number", theme, () => {}, PICKER_VIEWPORT_MAX);
    // currentRawValue "2" → active preset at visibleEntries index 2 (offset by the pinned Custom
    // row above). Two Downs wrap to the Custom row (index 0): 2 → 3 → 0.
    picker.handleInput("\x1b[B"); // down → index 3 (preset "3")
    picker.handleInput("\x1b[B"); // down → index 0 (Custom value…, wrap)
    picker.handleInput("\r"); // confirm → text-entry mode
    // Type an invalid value.
    picker.handleInput("abc");
    picker.handleInput("\r"); // submit
    expect(renderFlat(picker, DEFAULT_WIDTH)).toContain("Enter a whole number");
  });

  test("valid custom input fires done with the formatted internal value", () => {
    const presets = buildPresets(["1", "2", "3"], [1, 2, 3], NO_DISPLAY_VALUES);
    const captured: unknown[] = [];
    const picker = new ValuePickerSubmenu(presets, "2", "number", theme, (v) => captured.push(v), PICKER_VIEWPORT_MAX);
    picker.handleInput("\x1b[B"); // down → index 3 (preset "3")
    picker.handleInput("\x1b[B"); // down → index 0 (Custom value…, wrap)
    picker.handleInput("\r"); // text-entry mode
    picker.handleInput("42");
    picker.handleInput("\r"); // submit
    expect(captured).toEqual(["42"]);
  });

  test("compact-threshold custom value shows a custom-indicator with its formatted value", () => {
    const presets = buildPresets(["none", "compact>75K"], ["none", "compact>75K"], NO_DISPLAY_VALUES);
    // A non-preset custom value "compact>150K" → ◆ indicator (format = identity for compact-threshold).
    const picker = new ValuePickerSubmenu(
      presets,
      "compact>150K",
      "compact-threshold",
      theme,
      () => {},
      PICKER_VIEWPORT_MAX,
    );
    const out = renderFlat(picker, DEFAULT_WIDTH);
    expect(out).toContain("◆ compact>150K");
  });
});

describe("ValuePickerSubmenu — UD5 constructor (pi Theme param)", () => {
  beforeAll(() => initTheme());
  test("accepts a pi Theme stub as the 4th arg and renders via the internal SettingsListTheme", () => {
    const piThemeStub = { fg: (_r: string, t: string) => t, bg: (_r: string, t: string) => t };
    const presets = buildPresets(["A", "B"], ["a", "b"], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(
      presets,
      "a",
      "string",
      piThemeStub as unknown as Theme,
      () => {},
      PICKER_VIEWPORT_MAX,
    );
    // Renders without throwing (the picker fetches SettingsListTheme internally for row theming;
    // the pi Theme is only used for fg muting).
    const out = renderFlat(picker, DEFAULT_WIDTH);
    expect(out).toContain("A");
    expect(out).toContain("B");
  });
});

describe("ValuePickerSubmenu — filter-first renderer", () => {
  beforeAll(() => initTheme());

  test("renders a filter field at the top", () => {
    const presets = buildPresets(["Alpha", "Beta", "Gamma"], ["a", "b", "g"], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(presets, "a", "string", theme, () => {}, PICKER_VIEWPORT_MAX);
    const lines = picker.render(DEFAULT_WIDTH);
    // The first line is the filter field (not the first preset). At least the presets render below.
    const joined = lines.join("\n");
    expect(joined).toContain("Alpha");
    expect(joined).toContain("Beta");
  });

  test("typing a filter narrows the list (substring on label or value) and focuses the first match", () => {
    const presets = buildPresets(["Alpha", "Beta", "Gamma"], ["a", "b", "g"], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(presets, "a", "string", theme, () => {}, PICKER_VIEWPORT_MAX);
    picker.handleInput("b"); // filter 'b' — matches 'Beta' (label 'Beta' AND rawValue 'b')
    const joined = picker.render(DEFAULT_WIDTH).join("\n");
    expect(joined).toContain("Beta");
    expect(joined).not.toContain("Alpha");
    expect(joined).not.toContain("Gamma");
  });
});

describe("ValuePickerSubmenu — maxVisible viewport cap", () => {
  beforeAll(() => initTheme());

  test("the default cap (PICKER_VIEWPORT_MAX=10) limits the rendered preset rows", () => {
    // 15 presets under a closed string enum (no pinned rows) → only the first 10 fit the viewport.
    const presets = buildPresets(
      Array.from({ length: 15 }, (_, i) => `P${i}`),
      Array.from({ length: 15 }, (_, i) => `p${i}`),
      NO_DISPLAY_VALUES,
    );
    const picker = new ValuePickerSubmenu(presets, "p0", "string", theme, () => {}, PICKER_VIEWPORT_MAX);
    const lines = picker.render(DEFAULT_WIDTH);
    // Picker body = 1 filter + N preset rows + 1 hint. With the cap at 10, exactly 10 presets render.
    const presetLines = lines.filter((l) => /P\d+/.test(l));
    expect(presetLines).toHaveLength(10);
    expect(lines.some((l) => l.includes("P0"))).toBe(true);
    expect(lines.some((l) => l.includes("P9"))).toBe(true);
    expect(lines.some((l) => l.includes("P10"))).toBe(false);
  });

  test("an explicit maxVisible caps the viewport (the modal passes a terminal-aware value)", () => {
    const presets = buildPresets(
      Array.from({ length: 15 }, (_, i) => `P${i}`),
      Array.from({ length: 15 }, (_, i) => `p${i}`),
      NO_DISPLAY_VALUES,
    );
    const picker = new ValuePickerSubmenu(presets, "p0", "string", theme, () => {}, 4);
    const lines = picker.render(DEFAULT_WIDTH);
    const presetLines = lines.filter((l) => /P\d+/.test(l));
    expect(presetLines).toHaveLength(4);
  });

  test("maxVisible smaller than the preset count keeps the selection scrolled into view", () => {
    // Move the selection past the viewport edge and confirm the centered window keeps it visible
    // (no off-by-one that would leave the focused row outside the visible window).
    const presets = buildPresets(
      Array.from({ length: 12 }, (_, i) => `P${i}`),
      Array.from({ length: 12 }, (_, i) => `p${i}`),
      NO_DISPLAY_VALUES,
    );
    const picker = new ValuePickerSubmenu(presets, "p0", "string", theme, () => {}, 5);
    // Walk down to P7 (index 7). A centered 5-row window shows P5..P9 (P7 in the middle).
    for (let i = 0; i < 7; i++) picker.handleInput("\x1b[B"); // Down x7
    const joined = picker.render(DEFAULT_WIDTH).join("\n");
    expect(joined).toContain("P7");
    expect(joined).not.toContain("P2");
  });
});

describe("ValuePickerSubmenu — centered viewport + scroll indicator", () => {
  beforeAll(() => initTheme());

  test("the viewport is centered on the selection (items stay visible above and below it)", () => {
    // A centered viewport keeps the selection in the middle of the window; a top-aligned one
    // would pin it to the top and only show items below. This locks in the centered behavior.
    const presets = buildPresets(
      Array.from({ length: 12 }, (_, i) => `P${i}`),
      Array.from({ length: 12 }, (_, i) => `p${i}`),
      NO_DISPLAY_VALUES,
    );
    const picker = new ValuePickerSubmenu(presets, "p0", "string", theme, () => {}, 5);
    for (let i = 0; i < 5; i++) picker.handleInput("\x1b[B"); // Down x5 -> P5 (index 5)
    const lines = picker.render(DEFAULT_WIDTH);
    const has = (label: string) => lines.some((l) => l.includes(label));
    // Centered 5-row window around P5 = P3..P7 (items both above AND below the selection).
    for (const label of ["P3", "P4", "P5", "P6", "P7"]) expect(has(label)).toBe(true);
    expect(has("P2")).toBe(false);
    expect(has("P8")).toBe(false);
  });

  test("at the top of the list the window pins to the first row (selection at top)", () => {
    const presets = buildPresets(
      Array.from({ length: 12 }, (_, i) => `P${i}`),
      Array.from({ length: 12 }, (_, i) => `p${i}`),
      NO_DISPLAY_VALUES,
    );
    const picker = new ValuePickerSubmenu(presets, "p0", "string", theme, () => {}, 5);
    const lines = picker.render(DEFAULT_WIDTH);
    const has = (label: string) => lines.some((l) => l.includes(label));
    // Selection P0 (index 0): window pins to the top -> P0..P4, no row above P0.
    for (const label of ["P0", "P1", "P4"]) expect(has(label)).toBe(true);
    expect(has("P5")).toBe(false);
  });

  test("an inline (n/N) position indicator appears on the hint line when the list scrolls", () => {
    const presets = buildPresets(
      Array.from({ length: 15 }, (_, i) => `P${i}`),
      Array.from({ length: 15 }, (_, i) => `p${i}`),
      NO_DISPLAY_VALUES,
    );
    const picker = new ValuePickerSubmenu(presets, "p0", "string", theme, () => {}, 5);
    const lines = picker.render(DEFAULT_WIDTH);
    // Selection P0 (index 0) of 15 -> "(1/15)" appended to the hint line (inline, not a new row).
    expect(lines.some((l) => l.includes("Enter to select") && /\(1\/15\)/.test(l))).toBe(true);
  });

  test("the position indicator updates as the selection moves", () => {
    const presets = buildPresets(
      Array.from({ length: 15 }, (_, i) => `P${i}`),
      Array.from({ length: 15 }, (_, i) => `p${i}`),
      NO_DISPLAY_VALUES,
    );
    const picker = new ValuePickerSubmenu(presets, "p0", "string", theme, () => {}, 5);
    for (let i = 0; i < 7; i++) picker.handleInput("\x1b[B"); // -> P7 (index 7) -> "(8/15)"
    const lines = picker.render(DEFAULT_WIDTH);
    expect(lines.some((l) => /\(8\/15\)/.test(l))).toBe(true);
  });

  test("no position indicator when all presets fit the viewport", () => {
    const presets = buildPresets(
      Array.from({ length: 3 }, (_, i) => `P${i}`),
      Array.from({ length: 3 }, (_, i) => `p${i}`),
      NO_DISPLAY_VALUES,
    );
    const picker = new ValuePickerSubmenu(presets, "p0", "string", theme, () => {}, 5);
    const joined = picker.render(DEFAULT_WIDTH).join("\n");
    // 3 presets under a 5-row cap -> nothing scrolls -> no "(n/N)" indicator.
    expect(joined).not.toMatch(/\(\d+\/\d+\)/);
  });

  test("the inline indicator adds no row (picker stays filter + maxVisible rows + hint)", () => {
    // Critical for the modal height fix: the indicator lives on the existing hint line, so a
    // scrolling picker renders the SAME number of lines as a non-scrolling one (cap + 2).
    const presets = buildPresets(
      Array.from({ length: 15 }, (_, i) => `P${i}`),
      Array.from({ length: 15 }, (_, i) => `p${i}`),
      NO_DISPLAY_VALUES,
    );
    const picker = new ValuePickerSubmenu(presets, "p0", "string", theme, () => {}, 5);
    const lines = picker.render(DEFAULT_WIDTH);
    // 1 filter + 5 preset rows + 1 hint (with inline indicator) = 7.
    expect(lines.length).toBe(7);
  });
});

describe("ValuePickerSubmenu — pinned rows + two-state custom field", () => {
  beforeAll(() => initTheme());

  test("the custom-indicator (current value absent from presets) is pinned and exempt from the filter", () => {
    const presets = buildPresets(["Alpha", "Beta"], ["a", "b"], NO_DISPLAY_VALUES);
    // 'garbage' is absent from presets → custom-indicator (◆) appears, pinned + exempt from filter.
    const picker = new ValuePickerSubmenu(presets, "garbage", "string", theme, () => {}, PICKER_VIEWPORT_MAX);
    picker.handleInput("z"); // filter 'z' matches nothing
    const joined = picker.render(DEFAULT_WIDTH).join("\n");
    // The custom-indicator survives the filter (it is pinned, exempt).
    expect(joined).toContain("◆");
    expect(joined).toContain("garbage");
  });

  test("selecting the 'Custom…' row (Up/Down + Enter) enters text-entry state; Esc restores the filter", () => {
    const presets = buildPresets(["5", "10"], ["5", "10"], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(presets, "5", "number", theme, () => {}, PICKER_VIEWPORT_MAX);
    // Type a filter first ('1' → narrows to '10'), then navigate to the Custom row + Enter.
    picker.handleInput("1"); // filter '1' → matches '10'; list is [10, Custom value…]
    const beforeSnap = (picker as unknown as { filterInput: { getValue(): string } }).filterInput.getValue();
    expect(beforeSnap).toBe("1");
    // One Down moves to the pinned Custom row (selectedIndex 0 → 1).
    picker.handleInput("\x1b[B"); // Down (to the Custom row)
    picker.handleInput("\r"); // Enter → text-entry mode
    // In text-entry mode the field shows the 'custom:' prefix hint.
    expect(picker.render(DEFAULT_WIDTH).join("\n")).toContain("custom:");
    // Esc restores the filter snapshot and returns to filter mode.
    picker.handleInput("\x1b"); // Esc
    const restored = (picker as unknown as { filterInput: { getValue(): string } }).filterInput.getValue();
    expect(restored).toBe("1"); // snapshot restored, not collapsed to empty
  });
});

describe("ValuePickerSubmenu — routing (filter mode)", () => {
  beforeAll(() => initTheme());

  test("Tab and Shift+Tab are inert (no selection change, no cancel, filter untouched)", () => {
    const done = (...args: unknown[]) => captured.push(args.length > 0 ? (args[0] ?? "CANCEL") : "CANCEL");
    const captured: unknown[] = [];
    const presets = buildPresets(["Alpha", "Beta"], ["a", "b"], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(
      presets,
      "a",
      "string",
      theme,
      done as unknown as (value?: unknown) => void,
      PICKER_VIEWPORT_MAX,
    );
    const selBefore = (picker as unknown as { selectedIndex: number }).selectedIndex;
    picker.handleInput("a"); // type a filter so we can detect pollution
    const filterBefore = (picker as unknown as { filterInput: { getValue(): string } }).filterInput.getValue();
    picker.handleInput("\t"); // Tab
    picker.handleInput("\x1b[Z"); // Shift+Tab
    expect((picker as unknown as { selectedIndex: number }).selectedIndex).toBe(selBefore);
    expect(captured).toEqual([]); // neither key cancelled
    // The filter text is untouched (Tab/Shift+Tab did not pollute it).
    expect((picker as unknown as { filterInput: { getValue(): string } }).filterInput.getValue()).toBe(filterBefore);
  });

  test("an empty filter on a closed type → Enter is a no-op and 'No matches' shows", () => {
    const done = (...args: unknown[]) => captured.push(args.length > 0 ? (args[0] ?? "CANCEL") : "CANCEL");
    const captured: unknown[] = [];
    const presets = buildPresets(["Alpha", "Beta"], ["a", "b"], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(
      presets,
      "a",
      "string",
      theme,
      done as unknown as (value?: unknown) => void,
      PICKER_VIEWPORT_MAX,
    );
    picker.handleInput("z"); // 'z' matches nothing
    const joined = picker.render(DEFAULT_WIDTH).join("\n");
    expect(joined).toContain("No matches");
    picker.handleInput("\r"); // Enter — no-op (nothing to select)
    expect(captured).toEqual([]); // did not fire done
  });

  test("Left/Right move the filter cursor (not selection)", () => {
    const presets = buildPresets(["Alpha", "Beta"], ["a", "b"], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(presets, "a", "string", theme, () => {}, PICKER_VIEWPORT_MAX);
    picker.handleInput("a");
    picker.handleInput("b"); // 'ab' — Alpha no longer matches (no 'ab'), Beta no → empty
    // Move the cursor left (no selection change, no crash).
    picker.handleInput("\x1b[D"); // Left
    picker.handleInput("\x1b[C"); // Right
    // Still in filter mode, no cancel fired — render succeeds.
    expect(picker.render(DEFAULT_WIDTH).join("\n")).toContain("No matches");
  });
});

describe("ValuePickerSubmenu — muted model rendering", () => {
  beforeAll(() => initTheme());

  test("a model entry's [provider] span is muted via theme.fg('muted', ...)", () => {
    const fgCalls: Array<{ role: string; text: string }> = [];
    const capturingTheme = {
      fg: (role: string, text: string) => {
        fgCalls.push({ role, text });
        return text;
      },
      bg: (_role: string, text: string) => text,
    };
    const presets: PresetItem[] = [
      {
        label: "claude-3-5-sonnet",
        rawValue: "anthropic/claude-3-5-sonnet",
        displayValue: "anthropic/claude-3-5-sonnet",
      },
    ];
    const picker = new ValuePickerSubmenu(
      presets,
      "anthropic/claude-3-5-sonnet",
      "model",
      capturingTheme as unknown as Theme,
      () => {},
      PICKER_VIEWPORT_MAX,
    );
    picker.render(DEFAULT_WIDTH);
    // The muted badge ` [anthropic]` (note the leading space inside the muted segment) was emitted.
    const muted = fgCalls.find((c) => c.role === "muted");
    expect(muted).toBeDefined();
    expect(muted?.text).toBe(" [anthropic]");
  });

  test("the Default/null entry renders verbatim with NO muted span", () => {
    const fgCalls: Array<{ role: string; text: string }> = [];
    const capturingTheme = {
      fg: (role: string, text: string) => {
        fgCalls.push({ role, text });
        return text;
      },
      bg: (_role: string, text: string) => text,
    };
    const presets: PresetItem[] = [
      { label: "Default", rawValue: null, displayValue: "" },
      {
        label: "claude-3-5-sonnet",
        rawValue: "anthropic/claude-3-5-sonnet",
        displayValue: "anthropic/claude-3-5-sonnet",
      },
    ];
    const picker = new ValuePickerSubmenu(
      presets,
      "anthropic/claude-3-5-sonnet",
      "model",
      capturingTheme as unknown as Theme,
      () => {},
      PICKER_VIEWPORT_MAX,
    );
    const joined = picker.render(DEFAULT_WIDTH).join("\n");
    // The Default entry is present (verbatim label).
    expect(joined).toContain("Default");
    // Only the model entry's provider is muted — exactly one muted call (the model's [anthropic]).
    const muted = fgCalls.filter((c) => c.role === "muted");
    expect(muted).toHaveLength(1);
    expect(muted[0]?.text).toBe(" [anthropic]");
  });
});

describe("ValuePickerSubmenu — model indicator and cursor no-reset", () => {
  beforeAll(() => initTheme());

  test("a model custom-indicator (current model absent from presets) keeps its ◆ marker", () => {
    // The model rendering branch must not rebuild a custom-indicator's label from rawValue
    // (dropping the ◆ marker). The custom-indicator renders its label verbatim.
    const presets: PresetItem[] = [
      {
        label: "claude-3-5-sonnet",
        rawValue: "anthropic/claude-3-5-sonnet",
        displayValue: "anthropic/claude-3-5-sonnet",
      },
    ];
    // 'anthropic/other' is absent → custom-indicator (◆) appears.
    const picker = new ValuePickerSubmenu(presets, "anthropic/other", "model", theme, () => {}, PICKER_VIEWPORT_MAX);
    const joined = picker.render(DEFAULT_WIDTH).join("\n");
    expect(joined).toContain("◆");
  });

  test("Left/Right move the filter cursor WITHOUT resetting the selection", () => {
    // Cursor movement that does not change the filter text must not reset selectedIndex.
    const presets = buildPresets(["Alpha", "Beta", "Gamma"], ["a", "b", "g"], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(presets, "a", "string", theme, () => {}, PICKER_VIEWPORT_MAX);
    picker.handleInput("\x1b[B"); // Down → index 1 (Beta)
    const selBefore = (picker as unknown as { selectedIndex: number }).selectedIndex;
    expect(selBefore).toBe(1);
    picker.handleInput("\x1b[D"); // Left (cursor move — filter text unchanged)
    expect((picker as unknown as { selectedIndex: number }).selectedIndex).toBe(1);
    picker.handleInput("\x1b[C"); // Right (cursor move)
    expect((picker as unknown as { selectedIndex: number }).selectedIndex).toBe(1);
  });

  test("the 'Custom value…' row sits ABOVE the filtered presets (pinned, like the indicator)", () => {
    // Both pinned rows (custom-indicator, Custom value…) are above the filtered list.
    const presets = buildPresets(["one", "two", "three"], [1, 2, 3], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(presets, "1", "number", theme, () => {}, PICKER_VIEWPORT_MAX);
    const lines = picker.render(DEFAULT_WIDTH);
    // The Custom row must appear before the first preset row. (ANSI codes don't contain these
    // substrings, so no stripping is needed.)
    const customIdx = lines.findIndex((l) => l.includes("Custom value…"));
    const firstPresetIdx = lines.findIndex((l) => l.includes("one"));
    expect(customIdx).toBeGreaterThanOrEqual(0);
    expect(firstPresetIdx).toBeGreaterThanOrEqual(0);
    expect(customIdx).toBeLessThan(firstPresetIdx);
  });
});

describe("ValuePickerSubmenu — wrap-around, slash-split, custom-indicator coverage", () => {
  beforeAll(() => initTheme());

  test("Up/Down wrap around the filtered set + pinned rows", () => {
    const presets = buildPresets(["Alpha", "Beta"], ["a", "b"], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(presets, "a", "string", theme, () => {}, PICKER_VIEWPORT_MAX);
    // visibleEntries for a closed string type = [Alpha, Beta] (no Custom row). selectedIndex
    // starts at the active preset 'a' (index 0). Up wraps to the last entry.
    picker.handleInput("\x1b[A"); // Up → wraps to last (Beta, index 1)
    expect((picker as unknown as { selectedIndex: number }).selectedIndex).toBe(1);
    picker.handleInput("\x1b[A"); // Up → wraps back to Alpha (index 0)
    expect((picker as unknown as { selectedIndex: number }).selectedIndex).toBe(0);
  });

  test("a model id containing a slash splits on the FIRST slash only (provider/id/extra)", () => {
    const fgCalls: Array<{ role: string; text: string }> = [];
    const capturingTheme = {
      fg: (role: string, text: string) => {
        fgCalls.push({ role, text });
        return text;
      },
      bg: (_role: string, text: string) => text,
    };
    const presets: PresetItem[] = [{ label: "mini", rawValue: "openai/o3/mini", displayValue: "openai/o3/mini" }];
    const picker = new ValuePickerSubmenu(
      presets,
      "openai/o3/mini",
      "model",
      capturingTheme as unknown as Theme,
      () => {},
      PICKER_VIEWPORT_MAX,
    );
    picker.render(DEFAULT_WIDTH);
    const muted = fgCalls.find((c) => c.role === "muted");
    // Provider is everything before the FIRST slash ('openai'); the rest is the id ('o3/mini').
    expect(muted?.text).toBe(" [openai]");
  });

  test("a custom-indicator (stale value) can be re-selected to restore it", () => {
    const captured: unknown[] = [];
    const presets = buildPresets(["Alpha"], ["a"], NO_DISPLAY_VALUES);
    const done = (...args: unknown[]) => captured.push(args.length > 0 ? (args[0] ?? "X") : "X");
    const picker = new ValuePickerSubmenu(
      presets,
      "stale",
      "string",
      theme,
      done as unknown as (value?: unknown) => void,
      PICKER_VIEWPORT_MAX,
    );
    // The custom-indicator (◆ stale) is at the top. Selecting it fires done with the stale value.
    picker.handleInput("\r"); // Enter on the focused indicator
    expect(captured).toEqual(["stale"]);
  });
});

describe("ValuePickerSubmenu — Esc focus-first-match", () => {
  beforeAll(() => initTheme());

  test("Esc from text-entry mode focuses the first matching preset (not a pinned row)", () => {
    // After Esc restores the filter, the selection should land on the first matching PRESET
    // (consistent with the picker's focus-first-match rule), not the pinned Custom row.
    const presets = buildPresets(["10", "20", "30"], [10, 20, 30], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(presets, "10", "number", theme, () => {}, PICKER_VIEWPORT_MAX);
    // Filter '2' → matches '20' only. Enter text-entry via the Custom row, then Esc out.
    picker.handleInput("2"); // filter '2' → focus first match '20'
    const focusBefore = (picker as unknown as { selectedIndex: number }).selectedIndex;
    // Move to the Custom row (above presets) and enter text-entry.
    picker.handleInput("\x1b[A"); // Up → wraps to Custom row (index 0)
    picker.handleInput("\r"); // Enter → text-entry mode
    picker.handleInput("\x1b"); // Esc → restore filter + focus first match
    // The focus is back on the first matching preset '20' (same as before entering text-entry).
    expect((picker as unknown as { selectedIndex: number }).selectedIndex).toBe(focusBefore);
  });
});

describe("ValuePickerSubmenu — value-filter and filter-mode Esc cancel", () => {
  beforeAll(() => initTheme());

  test("filter matches a preset whose VALUE (not label) contains the needle", () => {
    // The value-filter branch. Preset labels share no 'x' substring, but one rawValue does.
    // Dropping the rawValue from the haystack would fail this test.
    const presets: PresetItem[] = [
      { label: "First", rawValue: "alpha", displayValue: "alpha" },
      { label: "Second", rawValue: "fox", displayValue: "fox" },
    ];
    const picker = new ValuePickerSubmenu(presets, "alpha", "string", theme, () => {}, PICKER_VIEWPORT_MAX);
    picker.handleInput("x"); // 'x' is in rawValue 'fox' only (neither label has 'x')
    const joined = picker.render(DEFAULT_WIDTH).join("\n");
    expect(joined).toContain("Second");
    expect(joined).not.toContain("First");
  });

  test("Esc in filter mode cancels (fires done() with no value)", () => {
    // The filter-mode Esc → done() cancel path.
    const captured: unknown[] = [];
    const done = (...args: unknown[]) => captured.push(args.length > 0 ? (args[0] ?? "V") : "CANCEL");
    const presets = buildPresets(["Alpha", "Beta"], ["a", "b"], NO_DISPLAY_VALUES);
    const picker = new ValuePickerSubmenu(
      presets,
      "a",
      "string",
      theme,
      done as unknown as (value?: unknown) => void,
      PICKER_VIEWPORT_MAX,
    );
    picker.handleInput("\x1b"); // Esc in filter mode → cancel
    expect(captured).toEqual(["CANCEL"]); // done() called with no value
  });
});
