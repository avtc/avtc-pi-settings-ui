// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { TabDefinition } from "../src/schema.js";
import { SettingsTabsModal } from "../src/ui/settings-modal.js";

/**
 * Minimal Theme stub: identity fg/bg so assertions can reason about plain text (no muting).
 * The real Theme is heavy to construct; the modal only calls theme.fg/theme.bg for the tab bar
 * and the muted model span — identity is sufficient for layout/routing assertions.
 */
const stubTheme: Theme = {
  fg: (_role: string, text: string) => text,
  bg: (_role: string, text: string) => text,
} as unknown as Theme;

/** Build a two-tab modal fixture: General (3 items) and Advanced (2 items). */
function buildTwoTabs(): TabDefinition[] {
  return [
    {
      label: "General",
      settings: [
        { id: "name", label: "Name", value: "alpha", displayValue: "alpha", type: "string" },
        { id: "mode", label: "Mode", value: "beta", displayValue: "beta", type: "string" },
        { id: "count", label: "Count", value: "3", displayValue: "3", type: "number" },
      ],
    },
    {
      label: "Advanced",
      settings: [
        { id: "debug", label: "Debug", value: "true", displayValue: "true", type: "boolean" },
        { id: "path", label: "Path", value: "/x", displayValue: "/x", type: "string" },
      ],
    },
  ];
}

/** Three string items: [Xone, Atwo, Athree]. A filter 'a' matches only Atwo & Athree
 *  (Xone has no 'a'), so Xone is dropped from the FRONT of the filtered list — which is exactly
 *  the case where indexing the unfiltered array after Up/Down would pick the wrong item. */
function buildThreeMatchingTabs(): TabDefinition[] {
  return [
    {
      label: "T",
      settings: [
        { id: "xone", label: "Xone", value: "xone", displayValue: "xone", type: "string", description: "xone-desc" },
        { id: "atwo", label: "Atwo", value: "atwo", displayValue: "atwo", type: "string", description: "atwo-desc" },
        {
          id: "athree",
          label: "Athree",
          value: "athree",
          displayValue: "athree",
          type: "string",
          description: "athree-desc",
        },
      ],
    },
  ];
}

describe("SettingsTabsModal — top filter field + Tab/Shift+Tab nav", () => {
  beforeAll(() => {
    // getSettingsListTheme() (called inside rebuildContent) throws "Theme not initialized"
    // under vitest until initTheme() has run. Initialize once for the whole suite.
    initTheme();
  });

  describe("picker open", () => {
    test("Enter opens the value picker for the focused (preset-backed) item", () => {
      // An item with presets wires a ValuePickerSubmenu; Enter (routed to settingsList) must open it.
      const tabs = (): TabDefinition[] => [
        {
          label: "T",
          settings: [
            {
              id: "mode",
              label: "Mode",
              value: "a",
              displayValue: "a",
              type: "string",
              presets: [
                { label: "A", rawValue: "a", displayValue: "a" },
                { label: "B", rawValue: "b", displayValue: "b" },
              ],
            },
          ],
        },
      ];
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: tabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      // Before Enter: no submenu open.
      const internals = () => (modal as unknown as { listInternals: { submenuComponent: unknown } }).listInternals;
      expect(internals().submenuComponent).toBeFalsy();
      modal.handleInput("\r"); // Enter
      expect(internals().submenuComponent).toBeTruthy();
    });

    test("the description stays visible for the focused item while its dropdown is open", () => {
      // Opening the value picker replaces the item list (so the setting label is no longer
      // rendered) and the description area must NOT be blanked — it stays rendered for the item
      // that opened the dropdown so the user keeps context.
      const tabs = (): TabDefinition[] => [
        {
          label: "T",
          settings: [
            {
              id: "mode",
              label: "Mode",
              value: "a",
              displayValue: "a",
              type: "string",
              description: "mode-help-text",
              presets: [
                { label: "A", rawValue: "a", displayValue: "a" },
                { label: "B", rawValue: "b", displayValue: "b" },
              ],
            },
          ],
        },
      ];
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: tabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      // Before opening: description is visible.
      expect(modal.render(60).join("\n")).toContain("mode-help-text");
      modal.handleInput("\r"); // Enter — open the dropdown
      const internals = (modal as unknown as { listInternals: { submenuComponent: unknown } }).listInternals;
      expect(internals.submenuComponent).toBeTruthy();
      // After opening: the description is STILL visible (not blanked).
      expect(modal.render(60).join("\n")).toContain("mode-help-text");
    });
  });

  describe("cache freshness after a value edit (syncActiveTab)", () => {
    test("after a value change, the next filter keystroke uses the NEW displayValue", () => {
      // The onChange path calls syncActiveTab() to refresh the list. cachedTabs must be refreshed
      // too, or the next filter keystroke filters on the OLD (stale) displayValue and the
      // just-edited item can be wrongly filtered out.
      let edited = false;
      const buildTabs = (): TabDefinition[] => [
        {
          label: "T",
          settings: [
            {
              id: "dur",
              label: "Duration",
              value: edited ? "Infinite" : "30s",
              displayValue: edited ? "Infinite" : "30s",
              type: "string",
            },
            { id: "nm", label: "Name", value: "abc", displayValue: "abc", type: "string" },
          ],
        },
      ];
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      // Simulate the user editing Duration from "30s" to "Infinite" (the onChange path refreshes
      // via syncActiveTab).
      edited = true;
      modal.syncActiveTab();
      // Now filter for the NEW value 'Infinite' — the Duration item must remain visible. If
      // cachedTabs is stale (still "30s"), Duration is wrongly filtered out.
      modal.handleInput("I");
      modal.handleInput("n"); // 'In' — matches 'Infinite' only (Name 'abc' has no 'In')
      const joined = modal.render(60).join("\n");
      expect(joined).toContain("Duration");
    });
  });

  describe("edge cases", () => {
    test("Space is a filter character (multi-word filter), not a picker-open key", () => {
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      // Type 'a' then Space then 'l' → filter 'a l' (substring with a space). On the General tab,
      // 'Name alpha' contains 'a l'? 'alpha' has no 'a l'. 'Mode beta' no. So no item matches the
      // multi-word 'a l' substring → empty result. The point: Space typed into the filter (not a
      // no-op, not a picker-open) — verify it's part of the filter text.
      modal.handleInput("a");
      modal.handleInput(" "); // Space — must append to the filter, not open a picker
      modal.handleInput("l");
      expect((modal as unknown as { filterInput: { getValue(): string } }).filterInput.getValue()).toBe("a l");
    });

    test("a single-tab modal: Tab/Shift+Tab are inert (nowhere to switch)", () => {
      const modal = new SettingsTabsModal(
        {
          title: "Settings",
          buildTabs: buildThreeMatchingTabs,
          onChange: () => {},
          onClose: () => {},
          enableSearch: false,
        },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      const before = (modal as unknown as { activeTab: number }).activeTab;
      modal.handleInput("\t"); // Tab
      modal.handleInput("\x1b[Z"); // Shift+Tab
      expect((modal as unknown as { activeTab: number }).activeTab).toBe(before);
      // The single tab's items are still visible.
      expect(modal.render(60).join("\n")).toContain("Atwo");
    });

    test("a filter that matches nothing renders without error (no crash, list collapses)", () => {
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      // 'zzz' matches no item on the General tab.
      expect(() => {
        modal.handleInput("z");
        modal.handleInput("z");
        modal.handleInput("z");
      }).not.toThrow();
      const joined = modal.render(60).join("\n");
      // No General item matches.
      expect(joined).not.toContain("Name");
      expect(joined).not.toContain("Mode");
      expect(joined).not.toContain("Count");
    });
  });

  describe("navigation under a filter", () => {
    test("Up/Down selects the correct FILTERED item (not the unfiltered one at that index)", () => {
      const modal = new SettingsTabsModal(
        {
          title: "Settings",
          buildTabs: buildThreeMatchingTabs,
          onChange: () => {},
          onClose: () => {},
          enableSearch: false,
          getDescription: (id) => (id.endsWith("-desc") ? undefined : `${id}-desc`),
        },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      // Filter 'a' → [Atwo, Athree] (Xone dropped from the front). Down moves to index 1 →
      // must select Athree (filtered[1]). Indexing the UNFILTERED array would wrongly pick
      // Atwo (unfiltered[1]) because Xone was dropped before it.
      modal.handleInput("a");
      modal.handleInput("\x1b[B"); // Down
      const joined = modal.render(60).join("\n");
      expect(joined).toContain("athree-desc");
      expect(joined).not.toContain("atwo-desc");
    });

    test("a no-op keystroke (Backspace on an empty filter) does NOT reset selection to item 0", () => {
      const modal = new SettingsTabsModal(
        {
          title: "Settings",
          buildTabs: buildThreeMatchingTabs,
          onChange: () => {},
          onClose: () => {},
          enableSearch: false,
          getDescription: (id) => (id.endsWith("-desc") ? undefined : `${id}-desc`),
        },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      // No filter — Down moves selection from Xone (index 0) to Atwo (index 1).
      modal.handleInput("\x1b[B"); // Down → Atwo selected
      expect(modal.render(60).join("\n")).toContain("atwo-desc");
      // Backspace on the EMPTY filter is a no-op (nothing to delete). The selection MUST stay
      // on Atwo — an unconditional rebuild would reset it to Xone (index 0).
      modal.handleInput("\x7f"); // Backspace (DEL)
      const after = modal.render(60).join("\n");
      expect(after).toContain("atwo-desc");
      expect(after).not.toContain("xone-desc");
    });
  });

  describe("per-keystroke cost (caching contract)", () => {
    test("typing multiple filter chars does NOT re-run buildTabs per keystroke", () => {
      let builds = 0;
      const modal = new SettingsTabsModal(
        {
          title: "Settings",
          buildTabs: () => {
            builds++;
            return buildThreeMatchingTabs();
          },
          onChange: () => {},
          onClose: () => {},
          enableSearch: false,
        },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      const buildsAfterOpen = builds; // the constructor ran buildTabs once (for the initial list)
      modal.handleInput("a");
      modal.handleInput("t"); // 'at' — narrows further
      modal.handleInput("h"); // 'ath'
      // Filter keystrokes reuse the cached tabs; buildTabs must not re-run per keystroke.
      expect(builds).toBe(buildsAfterOpen);
    });
  });

  describe("render budget", () => {
    test("the filter line is absorbed by the list budget (fixedMaxVisible shrinks by one)", () => {
      // A 20-item tab makes fixedMaxVisible terminal-height-determined (not capped at maxTabItems).
      // The filter line (preListLines +1) is absorbed by fixedMaxVisible (OVERHEAD +1 → one fewer
      // list row), so the rendered list shows exactly fixedMaxVisible item rows — not fixedMaxVisible+1.
      // If only one of the two budget constants were bumped, the list would overflow by one row.
      const bigSettings = Array.from({ length: 20 }, (_, i) => ({
        id: `s${i}`,
        label: `Item ${i}`,
        value: String(i),
        displayValue: String(i),
        type: "string" as const,
      }));
      const modal = new SettingsTabsModal(
        {
          title: "Settings",
          buildTabs: () => [{ label: "Big", settings: bigSettings }],
          onChange: () => {},
          onClose: () => {},
          enableSearch: false,
        },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      const lines = modal.render(60);
      // fixedMaxVisible = max(3, 24 - OVERHEAD(14)) = 10. The list body shows Item 0..Item 9 (10
      // rows); Item 10 must NOT be in the visible window (it would be if fixedMaxVisible were 11).
      expect(lines.filter((l) => l.includes("Item 9")).length).toBe(1);
      expect(lines.some((l) => l.includes("Item 10"))).toBe(false);
    });
  });

  describe("filter persistence", () => {
    test("the filter survives a tab switch (carries over to the new tab)", () => {
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      // Type 'e': on General, matches Name ('Name') and Mode ('Mode'/'beta') but not Count.
      modal.handleInput("e");
      modal.handleInput("\t"); // switch to Advanced — filter 'e' carries over.
      // On Advanced, 'e' matches Debug ('Debug'/'true') but not Path ('Path'/'/x').
      const joined = modal.render(60).join("\n");
      expect(joined).toContain("Debug");
      expect(joined).not.toContain("Path");
      // The filter text itself persisted (still 'e').
      expect((modal as unknown as { filterInput: { getValue(): string } }).filterInput.getValue()).toBe("e");
    });

    test("a fresh modal open starts with an empty filter", () => {
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      expect((modal as unknown as { filterInput: { getValue(): string } }).filterInput.getValue()).toBe("");
      // The full General list is visible (no filtering).
      const joined = modal.render(60).join("\n");
      expect(joined).toContain("Name");
      expect(joined).toContain("Mode");
      expect(joined).toContain("Count");
    });
  });

  describe("state-aware routing (value picker open)", () => {
    /** Read the modal's private activeTab to assert tab switches (or their absence). */
    function activeTabOf(modal: SettingsTabsModal): number {
      return (modal as unknown as { activeTab: number }).activeTab;
    }

    test("Tab does NOT switch tabs while the value-picker submenu is open (delegated to picker)", () => {
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      expect(activeTabOf(modal)).toBe(0); // General
      // Simulate the value-picker submenu being open: poke a truthy submenuComponent onto the
      // SettingsList (the modal reads it via listInternals to decide state-aware routing). The
      // modal's handleInput must then delegate EVERYTHING to settingsList — Tab must not switch.
      const internals = (
        modal as unknown as {
          listInternals: { submenuComponent: unknown };
        }
      ).listInternals;
      // A truthy stub that renders (the SettingsList delegates render to the open submenu).
      internals.submenuComponent = { render: () => ["picker"] } as unknown;
      modal.handleInput("\t"); // would switch to Advanced (tab 1) if not delegated
      expect(activeTabOf(modal)).toBe(0); // still General — Tab did not switch
    });

    test("Left/Right are inert (no tab switch) while submenu open", () => {
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      const internals = (
        modal as unknown as {
          listInternals: { submenuComponent: unknown };
        }
      ).listInternals;
      internals.submenuComponent = { render: () => ["picker"] } as unknown;
      modal.handleInput("\x1b[D"); // Left
      modal.handleInput("\x1b[C"); // Right
      expect(activeTabOf(modal)).toBe(0); // still General — Left/Right did not switch
    });
  });

  describe("tab switching", () => {
    test("Tab switches to the next tab (active tab's items change)", () => {
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      // Initially the General tab is active — its items are visible.
      expect(modal.render(60).join("\n")).toContain("Name");
      // Tab advances to the Advanced tab — General items disappear, Advanced items appear.
      modal.handleInput("\t");
      const advanced = modal.render(60).join("\n");
      expect(advanced).toContain("Debug");
      expect(advanced).toContain("Path");
      expect(advanced).not.toContain("Name");
    });

    test("Shift+Tab switches to the previous tab", () => {
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      modal.handleInput("\t"); // General -> Advanced
      expect(modal.render(60).join("\n")).toContain("Debug");
      modal.handleInput("\x1b[Z"); // Shift+Tab: Advanced -> General
      const general = modal.render(60).join("\n");
      expect(general).toContain("Name");
      expect(general).not.toContain("Debug");
    });

    test("Left/Right move the filter cursor, NOT tabs (active tab unchanged)", () => {
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      // Start on General (Name visible). Left then Right must NOT switch to Advanced.
      modal.handleInput("\x1b[D"); // Left
      expect(modal.render(60).join("\n")).toContain("Name");
      modal.handleInput("\x1b[C"); // Right
      expect(modal.render(60).join("\n")).toContain("Name");
      expect(modal.render(60).join("\n")).not.toContain("Debug");
    });
  });

  describe("filter field", () => {
    test("renders an always-active filter line above the list", () => {
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      const lines = modal.render(60);
      expect(lines.length).toBeGreaterThan(0);
      // The tab bar is no longer the first line — a filter field sits above it. The tab bar's
      // first active label (" General ") must therefore NOT be on line 0.
      expect(lines[0]).not.toContain("General");
      // The tab bar (containing both tab labels) is on line 1 (directly below the filter field).
      expect(lines[1]).toContain("General");
      expect(lines[1]).toContain("Advanced");
    });

    test("typing a printable char narrows the list to label/value matches (case-insensitive)", () => {
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      // General tab items: Name=alpha, Mode=beta, Count=3. Typing 'a' matches Name ('Name'/'alpha')
      // and Mode (value 'beta' ends in 'a'), but NOT Count ('Count'/'3' have no 'a').
      modal.handleInput("a");
      const joined = modal.render(60).join("\n");
      expect(joined).toContain("Name");
      expect(joined).toContain("Mode");
      expect(joined).not.toContain("Count");
    });

    test("Backspace edits the filter (default-sink to the filter field, not the list)", () => {
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      // Type 'ab' (narrows to Name/Mode which contain 'a' + 'b' in 'beta'/'alpha'? 'ab' substring:
      // 'alpha' has 'ab'? no; 'alpha' = a-l-p-h-a. So 'ab' matches nothing... use 'a' then backspace).
      modal.handleInput("a");
      modal.handleInput("b"); // 'ab' — 'alpha' has no 'ab', 'beta' has no 'ab' -> empty list
      // Backspace removes 'b' -> filter 'a' again -> Name/Mode visible once more.
      modal.handleInput("\x7f"); // Backspace (DEL / 0x7f)
      const joined = modal.render(60).join("\n");
      expect(joined).toContain("Name");
      expect(joined).toContain("Mode");
    });
  });

  describe("close (Esc + Ctrl+C)", () => {
    test("Esc closes the modal", () => {
      const onClose = vi.fn();
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      modal.handleInput("\x1b"); // Esc
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("Ctrl+C closes the modal (parity with Esc, mirroring pi-tui's select.cancel binding)", () => {
      const onClose = vi.fn();
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      modal.handleInput("\x03"); // Ctrl+C
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("in-list hint text", () => {
    test("Space is not advertised as a change key (it is a filter char now)", () => {
      const modal = new SettingsTabsModal(
        { title: "Settings", buildTabs: buildTwoTabs, onChange: () => {}, onClose: () => {}, enableSearch: false },
        stubTheme,
        { terminal: { rows: 24 } },
      );
      const joined = modal.render(60).join("\n");
      // The pi-tui-emitted hint advertises the change keys; after the filter-first rewrite Space
      // is a filter character, so the hint must NOT say "Enter/Space to change".
      expect(joined).not.toContain("Enter/Space to change");
    });
  });

  describe("dropdown height consistency (no jump on open)", () => {
    /** A model-like setting with MANY presets: the dropdown needs more rows than the 2-item list
     *  reserves, which is exactly the case that used to grow the modal when the picker opened. */
    function buildModelTabs(presetCount: number): TabDefinition[] {
      const presets = Array.from({ length: presetCount }, (_, i) => ({
        label: `model-${i} [prov]`,
        rawValue: `prov/model-${i}`,
        displayValue: `prov/model-${i}`,
      }));
      return [
        {
          label: "Models",
          settings: [
            { id: "m", label: "Model", value: "prov/model-0", displayValue: "prov/model-0", type: "model", presets },
            { id: "x", label: "Other", value: "a", displayValue: "a", type: "string" },
          ],
        },
      ];
    }

    test("opening a many-preset dropdown does NOT change the modal height", () => {
      // 15 presets exceed the picker cap (10) and far exceed the 2-item list — opening the picker
      // used to add ~9 lines. The modal now pre-reserves max(listRows, pickerMaxRows) so the
      // rendered line count is identical before and after the dropdown opens.
      const modal = new SettingsTabsModal(
        {
          title: "Settings",
          buildTabs: () => buildModelTabs(15),
          onChange: () => {},
          onClose: () => {},
          enableSearch: false,
        },
        stubTheme,
        { terminal: { rows: 30 } },
      );
      const closed = modal.render(70);
      const internals = (modal as unknown as { listInternals: { submenuComponent: unknown } }).listInternals;
      expect(internals.submenuComponent).toBeFalsy();
      modal.handleInput("\r"); // Enter — open the value picker
      expect(internals.submenuComponent).toBeTruthy();
      const open = modal.render(70);
      expect(open.length).toBe(closed.length);
    });

    test("the open dropdown is capped at pickerMaxRows (10) visible preset rows", () => {
      const modal = new SettingsTabsModal(
        {
          title: "Settings",
          buildTabs: () => buildModelTabs(15),
          onChange: () => {},
          onClose: () => {},
          enableSearch: false,
        },
        stubTheme,
        { terminal: { rows: 30 } },
      );
      modal.handleInput("\r"); // open the picker
      const joined = modal.render(70).join("\n");
      // The picker body shows exactly 10 of the 15 presets (the cap), never 12 (the old hardcoded cap).
      const presetMatches = joined.match(/model-\d+/g) ?? [];
      const distinct = new Set(presetMatches);
      expect(distinct.size).toBe(10);
      expect(distinct.has("model-0")).toBe(true);
      expect(distinct.has("model-9")).toBe(true);
      expect(distinct.has("model-10")).toBe(false);
      expect(distinct.has("model-12")).toBe(false); // the old 12-row cap would have shown this
    });

    test("the description area stays pinned (same line index) whether the dropdown is open or not", () => {
      // The list (2 items) is shorter than the reserved slot, so the description must be padded
      // down to a fixed slot end — not sit right under the list (which would make it slide when
      // the taller picker renders).
      const modal = new SettingsTabsModal(
        {
          title: "Settings",
          buildTabs: () => buildModelTabs(15),
          onChange: () => {},
          onClose: () => {},
          enableSearch: false,
          getDescription: () => "the-model-description",
        },
        stubTheme,
        { terminal: { rows: 30 } },
      );
      const closed = modal.render(70);
      const closedDescLine = closed.findIndex((l) => l.includes("the-model-description"));
      expect(closedDescLine).toBeGreaterThan(-1);
      modal.handleInput("\r"); // open the picker (the description stays rendered, pinned to its line)
      const open = modal.render(70);
      // The description must still be present at the SAME line index when the dropdown is open —
      // proving the description slot did not move AND the content is retained for context.
      expect(open.length).toBe(closed.length);
      expect(open[closedDescLine]).toContain("the-model-description");
    });
  });
});
