// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

// Pane controller tests: tab navigation, value interactions through the
// settings handle's gate, persistence actions, and the composed tree shape.
// Red first — the module does not exist.

import { describe, expect, test } from "vitest";
import { captureCtx } from "../src/ctx-store.js";
import { createSettingsExtension, type EnvStore } from "../src/factory.js";
import type { FsAdapter } from "../src/fs-adapter.js";
import { createPaneController, type PaneController, type PaneNotify } from "../src/pane/controller.js";
import { buildPaneTree } from "../src/pane/tree.js";
import type { SettingsSchema } from "../src/schema.js";

function memFs(files: Record<string, string> = {}): FsAdapter {
  const store = new Map(Object.entries(files));
  return {
    async read(path) {
      return store.get(path) ?? null;
    },
    async write(path, content) {
      store.set(path, content);
    },
    async exists(path) {
      return store.has(path);
    },
  };
}

const memEnv = (vars: Record<string, string> = {}): EnvStore => {
  const store = new Map(Object.entries(vars));
  return {
    get: (n) => store.get(n),
    set: (n, v) => store.set(n, v),
  };
};

const SCHEMA: SettingsSchema = {
  tabs: [
    { label: "General", settingIds: ["enabled", "interval", "name"] },
    { label: "Models", settingIds: ["model", "level"] },
  ],
  settings: [
    { id: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
    { id: "interval", label: "Interval", type: "duration", defaultValue: 30000, min: 1000, max: 600000 },
    { id: "name", label: "Name", type: "string", defaultValue: "owl", description: "A thing worth naming" },
    { id: "model", label: "Model", type: "model", defaultValue: null },
    {
      id: "level",
      label: "Level",
      type: "string",
      // the per-setting override the owl's model row uses — presets AND a
      // custom value field in one picker
      supportsCustomValues: true,
      defaultValue: "medium",
      presets: [
        ["Low", "low"],
        ["Medium", "medium"],
        ["High", "high"],
      ],
    },
  ],
  globalPath: (globalDir?: string) => `${globalDir ?? "/home"}/x-settings.json`,
  projectPath: (cwd: string) => `${cwd}/.claude/x-settings.json`,
} as unknown as SettingsSchema;

function makeFixture() {
  captureCtx({});
  const fs = memFs();
  const env = memEnv();
  const updates: Array<{ id: string; value: unknown }> = [];
  const handle = createSettingsExtension(SCHEMA, { fs, env, envVar: "TEST_SETTINGS" });
  const notify: PaneNotify = { message: () => {}, warn: () => {} };
  return { handle, notify, updates };
}

async function makeController() {
  const { handle, notify } = makeFixture();
  await handle.load("/work/proj", "/home");
  const controller = createPaneController(handle, {
    title: "Test Settings",
    notify,
    storageLevels: ["session", "project", "global"],
    cwd: "/work/proj",
  });
  return { controller, handle };
}

function anchored(controller: PaneController): PaneController & {
  anchorMove: (delta: 1 | -1) => void;
  anchorEnter: () => void;
  anchorFocusAttempt: (key: string | null) => "allow" | "deny";
  anchorSeatKey: () => string;
} {
  const c = controller as PaneController & {
    anchorMove?: (delta: 1 | -1) => void;
    anchorEnter?: () => void;
    anchorFocusAttempt?: (key: string | null) => "allow" | "deny";
    anchorSeatKey?: () => string;
  };
  if (c.anchorMove === undefined || c.anchorEnter === undefined || c.anchorFocusAttempt === undefined) {
    throw new Error("input-anchored API missing");
  }
  return c as PaneController & {
    anchorMove: (delta: 1 | -1) => void;
    anchorEnter: () => void;
    anchorFocusAttempt: (key: string | null) => "allow" | "deny";
    anchorSeatKey: () => string;
  };
}

describe("pane controller — tabs", () => {
  test("opens on the first tab; switching moves the active tab", async () => {
    const { controller } = await makeController();
    expect(controller.state().activeTabIndex).toBe(0);
    expect(controller.state().tabs[0]?.label).toBe("General");
    expect(controller.state().tabs).toHaveLength(2);
    controller.switchTab(1);
    expect(controller.state().activeTabIndex).toBe(1);
    expect(controller.state().tabs[1]?.label).toBe("Models");
  });

  test("out-of-range switch is ignored", async () => {
    const { controller } = await makeController();
    controller.switchTab(5);
    expect(controller.state().activeTabIndex).toBe(0);
  });
});

describe("pane controller — value interactions", () => {
  test("preset select maps the display value to the raw value through the gate", async () => {
    const { controller } = await makeController();
    const levelRow = controller.state().tabs[1]?.settings.find((s) => s.id === "level");
    expect(levelRow?.displayValue).toBe("Medium");
    controller.selectValue("level", "high");
    const updated = controller.state().tabs[1]?.settings.find((s) => s.id === "level");
    expect(updated?.displayValue).toBe("High");
    expect(controller.handle.getSettings().level).toBe("high");
    expect(controller.state().dirty).toBe(true);
  });

  test("free-text submit goes through the gate; invalid values are rejected", async () => {
    const { controller } = await makeController();
    controller.submitText("name", "heron");
    expect(controller.handle.getSettings().name).toBe("heron");
    controller.submitText("interval", "garbage");
    expect(controller.handle.getSettings().interval).toBe(30000);
  });

  test("state changes fire the invalidate hook (the host's repaint)", async () => {
    const { handle } = makeFixture();
    await handle.load("/work/proj", "/home");
    const repaints: number[] = [];
    const controller = createPaneController(handle, {
      title: "Test Settings",
      notify: { message: () => {}, warn: () => {} },
      storageLevels: ["session", "project", "global"],
      cwd: "/work/proj",
      onInvalidate: () => repaints.push(Date.now()),
    });
    expect(repaints).toHaveLength(0);
    controller.switchTab(1);
    expect(repaints).toHaveLength(1);
    controller.submitText("name", "heron");
    expect(repaints).toHaveLength(2);
    controller.toggle("enabled");
    expect(repaints).toHaveLength(3);
  });

  test("boolean toggle flips through the gate", async () => {
    const { controller } = await makeController();
    controller.toggle("enabled");
    expect(controller.handle.getSettings().enabled).toBe(false);
    controller.toggle("enabled");
    expect(controller.handle.getSettings().enabled).toBe(true);
  });
});

describe("pane controller — persistence actions", () => {
  test("persistGlobal writes the file and clears dirty; notify fires", async () => {
    const { controller } = await makeController();
    const messages: string[] = [];
    controller.submitText("name", "heron");
    controller.setNotify({ message: (m) => messages.push(m), warn: () => {} });
    await controller.persistGlobal();
    expect(controller.state().dirty).toBe(false);
    expect(messages).toHaveLength(1);
  });

  test("persistProject writes under the cwd", async () => {
    const { controller } = await makeController();
    controller.toggle("enabled");
    await controller.persistProject();
    expect(controller.state().dirty).toBe(false);
  });
});

describe("pane tree — element composition", () => {
  const ELEMENTS = {
    Box: (props: Record<string, unknown>) => ({ type: "Box", ...props }),
    Text: (props: Record<string, unknown>) => ({ type: "Text", ...props }),
    Button: (props: Record<string, unknown>) => ({ type: "Button", ...props }),
    Input: (props: Record<string, unknown>) => ({ type: "Input", ...props }),
    Select: (props: Record<string, unknown>) => ({ type: "Select", ...props }),
  };

  test("composes tabs row, value-button rows, and a footer (no dropdowns — the layout never jumps)", async () => {
    const { controller } = await makeController();
    const tree = buildPaneTree(ELEMENTS as never, controller, { bodyColumns: 80 });
    const json = JSON.stringify(tree);
    expect(json).toContain("Test Settings");
    expect(json).toContain("Enabled");
    // every value control is a Button opening the picker — no Select dropdowns
    expect(json).not.toContain('"type":"Select"');
    expect(json).toContain('"type":"Input"'); // the filter field
    // footer actions exist
    expect(json).toContain("Save project");
    expect(json).toContain("Save global");
    expect(json).toContain("Close");
  });

  test("tab buttons carry switch actions; value controls carry update actions", async () => {
    const { controller } = await makeController();
    const tree = buildPaneTree(ELEMENTS as never, controller, { bodyColumns: 80 }) as {
      children: Record<string, unknown>[];
    };
    const flat = JSON.stringify(tree);
    expect(flat).toContain("General");
    expect(flat).toContain("Models");
    // the boolean control is keyed by the setting id (the picker opens on press)
    expect(flat).toContain('"key":"enabled"');
    // the level select is keyed by its id — on ITS tab
    controller.switchTab(1);
    const modelsTree = JSON.stringify(buildPaneTree(ELEMENTS as never, controller, { bodyColumns: 80 }));
    expect(modelsTree).toContain('"key":"level"');
  });
});

describe("pane picker — pi's Enter-to-change value picker", () => {
  const ELEMENTS = {
    Box: (props: Record<string, unknown>) => ({ type: "Box", ...props }),
    Text: (props: Record<string, unknown>) => ({ type: "Text", ...props }),
    Button: (props: Record<string, unknown>) => ({ type: "Button", ...props }),
    Input: (props: Record<string, unknown>) => ({ type: "Input", ...props }),
    Select: (props: Record<string, unknown>) => ({ type: "Select", ...props }),
  };

  test("openPicker swaps the pane to the picker body; Esc-path closePicker returns", async () => {
    const { controller } = await makeController();
    controller.openPicker("enabled");
    const picking = controller.state();
    expect(picking.pickingRow?.id).toBe("enabled");
    expect(picking.pickerOptions.length).toBeGreaterThan(0);
    const tree = JSON.stringify(buildPaneTree(ELEMENTS as never, controller, { bodyColumns: 80 }));
    expect(tree).toContain("settings-picker");
    expect(tree).toContain("Enter to select · Esc to go back");
    expect(tree).toContain("← Back");
    expect(tree).not.toContain("Custom value…"); // boolean is a closed enum — no custom entry
    controller.openPicker("name"); // an open type shows it
    const namePicker = JSON.stringify(buildPaneTree(ELEMENTS as never, controller, { bodyColumns: 80 }));
    expect(namePicker).toContain("Custom value…");
    // presetless: the picker IS the custom input — no filter, no options
    expect(namePicker).not.toContain("picker-filter");
    expect(namePicker).not.toContain("pick:0");
    controller.closePicker();
    expect(controller.state().pickingRow).toBeNull();
    expect(JSON.stringify(buildPaneTree(ELEMENTS as never, controller, { bodyColumns: 80 }))).not.toContain(
      "settings-picker",
    );
  });

  test("pickPreset updates through the gate and leaves the picker; setPickerFilter narrows", async () => {
    const { controller } = await makeController();
    controller.switchTab(1);
    controller.openPicker("level");
    controller.setPickerFilter("hi");
    const filtered = controller.state().pickerOptions;
    expect(filtered.length).toBeLessThan(controller.state().pickingRow?.presets?.length ?? 0);
    controller.pickPreset("level", "High");
    expect(controller.state().pickingRow).toBeNull();
    expect(controller.handle.getSettings().level).toBe("high");
  });

  test("submitCustom goes through the gate and leaves the picker", async () => {
    const { controller } = await makeController();
    controller.openPicker("name");
    controller.submitCustom("name", "renamed");
    expect(controller.state().pickingRow).toBeNull();
    expect(controller.handle.getSettings().name).toBe("renamed");
  });

  test("the description follows the SELECTION; non-row focus keys never hijack it", async () => {
    const { controller } = await makeController();
    expect(controller.state().describedRow?.id).toBe(controller.state().visibleSettings[0]?.id);
    controller.anchorMove(1);
    expect(controller.state().describedRow?.id).toBe(controller.state().visibleSettings[1]?.id);
    // non-row keys (tabs, footer, filter) never hijack the description
    controller.setDescribedFromKey("settings-tab-1");
    expect(controller.state().describedRow?.id).toBe(controller.state().visibleSettings[1]?.id);
  });
});

describe("pane controller — the filter field (pi's live filter)", () => {
  test("setFilter narrows the visible rows over label + description, case-insensitive", async () => {
    const { controller } = await makeController();
    expect(controller.state().visibleSettings.length).toBeGreaterThan(1);
    controller.setFilter("enab");
    let visible = controller.state().visibleSettings;
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe("enabled");
    // the description matches too
    controller.setFilter("THING");
    visible = controller.state().visibleSettings;
    expect(visible.every((row) => `${row.label} ${row.description ?? ""}`.toLowerCase().includes("thing"))).toBe(true);
    expect(visible.length).toBeGreaterThan(0);
    // clearing restores
    controller.setFilter("");
    expect(controller.state().visibleSettings.length).toBeGreaterThan(1);
  });

  test("the described row follows the last interaction (pi's selected-row description area)", async () => {
    const { controller } = await makeController();
    expect(controller.state().describedRow?.id).toBe(controller.state().visibleSettings[0]?.id);
    controller.toggle("enabled");
    expect(controller.state().describedRow?.id).toBe("enabled");
  });
});

describe("pane tree — the pi-shaped layout", () => {
  const ELEMENTS = {
    Box: (props: Record<string, unknown>) => ({ type: "Box", ...props }),
    Text: (props: Record<string, unknown>) => ({ type: "Text", ...props }),
    Button: (props: Record<string, unknown>) => ({ type: "Button", ...props }),
    Input: (props: Record<string, unknown>) => ({ type: "Input", ...props }),
    Select: (props: Record<string, unknown>) => ({ type: "Select", ...props }),
  };

  test("the filter field sits first: autoFocus, live onInput, before the tabs", async () => {
    const { controller } = await makeController();
    const tree = buildPaneTree(ELEMENTS as never, controller, { bodyColumns: 80 }) as {
      children: Record<string, unknown>[];
    };
    const filter = tree.children.find(
      (child) =>
        typeof (child as { key?: string }).key === "string" &&
        (child as { key?: string }).key?.startsWith("settings-filter"),
    ) as Record<string, unknown>;
    expect(filter).toBeDefined();
    expect(filter.autoFocus).toBe(true);
    expect(typeof filter.onInput).toBe("function");
    // the tree order: title, filter, tabs, rows, description, footer
    const keys = tree.children.map((child) => (child as { key?: string }).key ?? "text");
    expect(keys.indexOf("settings-filter")).toBeLessThan(keys.indexOf("settings-tabs"));
    expect(keys.indexOf("settings-rows")).toBeLessThan(keys.indexOf("settings-description"));
    expect(keys.indexOf("settings-description")).toBeLessThan(keys.indexOf("settings-footer"));
  });

  test("rows are two-column (padded labels, no inline descriptions) and the description box carries them", async () => {
    const { controller } = await makeController();
    const tree = buildPaneTree(ELEMENTS as never, controller, { bodyColumns: 80 }) as {
      children: Record<string, unknown>[];
    };
    const rowsBox = tree.children.find((child) => (child as { key?: string }).key === "settings-rows") as {
      children: Array<{ children: Record<string, unknown>[] }>;
    };
    const firstRowCells = rowsBox.children[0]?.children ?? [];
    const labelText = JSON.stringify(firstRowCells[0]);
    // the label column carries ONLY the label — the description moved out
    expect(labelText).not.toContain(" — ");
    expect(typeof firstRowCells[0]?.children).toBe("object");
    // the padded column asks for the monospaced face (proportional surfaces
    // would misalign the value column; the terminal ignores the prop)
    expect((firstRowCells[0] as { mono?: boolean }).mono).toBe(true);
    const description = JSON.stringify(
      tree.children.find((child) => (child as { key?: string }).key === "settings-description"),
    );
    expect(description).toContain("dimColor");
    expect(description).toContain("mono");
  });

  test("the first tab carries autoFocus — the pane's initial focus ring starts there", async () => {
    const { controller } = await makeController();
    const tree = buildPaneTree(ELEMENTS as never, controller, { bodyColumns: 80 });
    const json = JSON.stringify(tree);
    const firstTab = json.indexOf('"settings-tab-0"');
    const lastTab = json.indexOf('"settings-tab-1"');
    // the tab lane's own autoFocus (the filter Input also carries one — it is
    // drawn first and wins on keyboard surfaces; the tab is the pointer
    // surfaces' explicit start)
    const autoFocusPos = json.indexOf('"autoFocus":true', firstTab);
    expect(autoFocusPos).toBeGreaterThan(-1);
    expect(autoFocusPos).toBeGreaterThan(firstTab);
    expect(autoFocusPos).toBeLessThan(lastTab); // only the first tab
    expect(json.indexOf('"autoFocus":true', autoFocusPos + 1)).toBe(-1);
  });

  test("the selection marker draws only on keyboard-driven surfaces", async () => {
    const { controller } = await makeController();
    const keyboard = JSON.stringify(buildPaneTree(ELEMENTS as never, controller, { bodyColumns: 80 }));
    expect(keyboard).toContain("→ "); // the arrow marker on the ring's row
    const desktop = JSON.stringify(
      buildPaneTree(ELEMENTS as never, controller, { bodyColumns: 80, surface: "desktop" }),
    );
    expect(desktop).not.toContain("→ "); // no walk to point at
    expect(desktop).not.toContain('"color":"claude"'); // no purple label seat
  });

  test("keyboard hints draw only on keyboard-driven surfaces (the legend and the picker hint drop on desktop)", async () => {
    const { controller } = await makeController();
    const keyboard = buildPaneTree(ELEMENTS as never, controller, { bodyColumns: 80 }) as {
      children: Record<string, unknown>[];
    };
    expect(JSON.stringify(keyboard)).toContain("settings-legend");
    const desktop = buildPaneTree(ELEMENTS as never, controller, {
      bodyColumns: 80,
      surface: "desktop",
    }) as { children: Record<string, unknown>[] };
    expect(JSON.stringify(desktop)).not.toContain("settings-legend");
    expect(JSON.stringify(desktop)).not.toContain("Esc | ↑↓: navigate");
  });
});

const LIVE_ELEMENTS = {
  Box: (props: Record<string, unknown>) => ({ type: "Box", ...props }),
  Text: (props: Record<string, unknown>) => ({ type: "Text", ...props }),
  Button: (props: Record<string, unknown>) => ({ type: "Button", ...props }),
  Input: (props: Record<string, unknown>) => ({ type: "Input", ...props }),
  Select: (props: Record<string, unknown>) => ({ type: "Select", ...props }),
};

describe("pane — the stateless single-file mode (live save)", () => {
  test("one file level: no save actions in the footer, no dirty marker, Close stays", async () => {
    const { handle, notify } = makeFixture();
    await handle.load("/work/proj", "/home");
    const controller = createPaneController(handle, {
      title: "Live Settings",
      notify,
      storageLevels: ["project"],
      cwd: "/work/proj",
    });
    controller.toggle("enabled");
    expect(controller.state().dirty).toBe(false); // live-save: never dirty
    const json = JSON.stringify(buildPaneTree(LIVE_ELEMENTS as never, controller, { bodyColumns: 80 }));
    expect(json).not.toContain("Save project");
    expect(json).not.toContain("Save global");
    expect(json).toContain("Close");
  });
});

describe("pane — picker close after a choice", () => {
  test("pickPreset and submitCustom hand the ring back (onPickerClosed fires with the row id)", async () => {
    const { handle, notify } = makeFixture();
    await handle.load("/work/proj", "/home");
    const closed: string[] = [];
    const controller = createPaneController(handle, {
      title: "T",
      notify,
      storageLevels: ["session", "project", "global"],
      cwd: "/work/proj",
      onPickerClosed: (rowId) => closed.push(rowId),
    });
    await controller.prepare();
    const enabledRow = controller.state().visibleSettings.find((r) => r.id === "enabled");
    const firstLabel = enabledRow?.presets?.[0]?.label;
    expect(firstLabel).toBeDefined();
    controller.openPicker("enabled");
    expect(controller.state().pickingRow).not.toBeNull();
    controller.pickPreset("enabled", firstLabel as string);
    expect(closed).toEqual(["enabled"]);
    expect(controller.state().pickingRow).toBeNull();
    controller.openPicker("interval");
    controller.submitCustom("interval", "2m");
    expect(closed).toEqual(["enabled", "interval"]);
    expect(handle.getSettings().interval).toBe(120000);
  });
});

describe("pane — the selection drives the description", () => {
  test("after a picker round-trip the described row follows the selection, not the opened row", async () => {
    const { handle, notify } = makeFixture();
    await handle.load("/work/proj", "/home");
    const controller = createPaneController(handle, {
      title: "T",
      notify,
      storageLevels: ["session", "project", "global"],
      cwd: "/work/proj",
    });
    // open + choose on one row, then move the selection elsewhere: the
    // description follows the SELECTION (the ring never leaves the filter)
    controller.anchorMove(1);
    const selected = controller.state().selectionId;
    controller.openPicker("enabled");
    await controller.prepare();
    controller.pickPreset("enabled", (controller.state().pickingRow?.presets ?? [{ label: "x" }])[0]?.label as string);
    expect(controller.state().describedRow?.id).toBe(selected);
  });
});

describe("pane controller — the input-anchored keyboard model", () => {
  async function makeInputController() {
    const { handle, notify } = makeFixture();
    await handle.load("/work/proj", "/home");
    const controller = createPaneController(handle, {
      title: "Test Settings",
      notify,
      storageLevels: ["session", "project", "global"],
      cwd: "/work/proj",
    });
    return { controller, handle };
  }

  test("the selection starts at the first visible row; the walk turns pages at the edges", async () => {
    const { controller } = await makeInputController();
    const rows = () => controller.state().visibleSettings.map((r) => r.id);
    const tab = () => controller.state().tabs[controller.state().activeTabIndex ?? 0]?.label;
    // General: enabled, interval, name — walk to the page's last row
    expect(controller.state().selectionId).toBe(rows()[0]);
    anchored(controller).anchorMove(1);
    expect(controller.state().selectionId).toBe(rows()[1]);
    anchored(controller).anchorMove(1);
    expect(controller.state().selectionId).toBe(rows()[2]); // name — last of General
    // Down off the bottom turns to the NEXT page's first row (Tab behaves
    // the same — the engine's focus signals carry no key identity)
    anchored(controller).anchorMove(1);
    expect(tab()).toBe("Models");
    expect(controller.state().selectionId).toBe(rows()[0]); // model
    // Up off the top returns to the previous page's LAST row
    anchored(controller).anchorMove(-1);
    expect(tab()).toBe("General");
    expect(controller.state().selectionId).toBe(rows()[2]);
    // continue up through General to its first row
    anchored(controller).anchorMove(-1);
    expect(controller.state().selectionId).toBe(rows()[1]);
    anchored(controller).anchorMove(-1);
    expect(controller.state().selectionId).toBe(rows()[0]);
    // Up off the first page's top cycles to the LAST page's last row
    anchored(controller).anchorMove(-1);
    expect(tab()).toBe("Models");
    expect(controller.state().selectionId).toBe(rows()[rows().length - 1]); // level
    // Down off the last page's bottom cycles back to the first page's first row
    anchored(controller).anchorMove(1);
    expect(tab()).toBe("General");
    expect(controller.state().selectionId).toBe(rows()[0]);
  });

  test("the filter narrows and the selection clamps into the visible set", async () => {
    const { controller } = await makeInputController();
    anchored(controller).anchorMove(1);
    anchored(controller).anchorMove(1);
    controller.setFilter(controller.state().visibleSettings[0]?.label.slice(0, 3) ?? "");
    const visible = controller.state().visibleSettings.map((r) => r.id);
    if (visible.length < 3) {
      expect(
        controller.state().selectionId === null || visible.includes(controller.state().selectionId as string),
      ).toBe(true);
    }
  });

  test("anchorEnter on a row opens its picker; anchorEnter in the picker chooses the active option", async () => {
    const { controller, handle } = await makeInputController();
    const updates: Array<{ id: string; value: unknown }> = [];
    const orig = (handle as unknown as { updateSetting: (k: string, v: unknown) => void }).updateSetting;
    (handle as unknown as { updateSetting: (k: string, v: unknown) => void }).updateSetting = (k, v) => {
      updates.push({ id: k, value: v });
      orig.call(handle, k, v);
    };
    // walk to the first preset-bearing row (the boolean)
    const ids = controller.state().visibleSettings.map((r) => r.id);
    const presetRow = controller.state().visibleSettings.find((r) => (r.presets?.length ?? 0) > 0);
    expect(presetRow).toBeDefined();
    let guard = 0;
    while (controller.state().selectionId !== presetRow?.id && guard++ < 10) anchored(controller).anchorMove(1);
    void ids;
    anchored(controller).anchorEnter();
    expect(controller.state().pickingRow).not.toBeNull();
    // choose the first option via Enter
    anchored(controller).anchorMove(1); // picker selection advances off -1 start? starts at 0
    anchored(controller).anchorEnter();
    expect(controller.state().pickingRow).toBeNull();
    expect(updates.length).toBe(1);
  });

  test("anchorFocusAttempt: direction by POSITION in the focus sequence (Down walks down, Up walks up)", async () => {
    const { controller } = await makeInputController();
    const first = controller.state().visibleSettings[0]?.id as string;
    const second = controller.state().visibleSettings[1]?.id as string;
    // our text inputs take the ring (typing must land in a field)
    expect(anchored(controller).anchorFocusAttempt("settings-filter")).toBe("allow");
    expect(anchored(controller).anchorFocusAttempt("settings-filter:7")).toBe("allow");
    expect(anchored(controller).anchorFocusAttempt("picker-filter:3")).toBe("allow");
    // the custom field is drawn only inside a picker — with the list up,
    // the proposal is denied like any other non-seat element
    expect(anchored(controller).anchorFocusAttempt("picker-custom")).toBe("deny");
    // a target AFTER the anchor (the tab strip follows the filter in the
    // tree) walks DOWN — the engine proposes settings-tab-0 for both Down
    // and Tab from the filter; the old index math inverted this
    expect(controller.state().selectionId).toBe(first);
    expect(anchored(controller).anchorFocusAttempt("settings-tab-0")).toBe("deny");
    expect(controller.state().selectionId).toBe(second);
    // repeated proposals keep walking down (the ring never leaves the seat)
    expect(anchored(controller).anchorFocusAttempt("settings-tab-1")).toBe("deny");
    expect(controller.state().selectionId).toBe(controller.state().visibleSettings[2]?.id ?? second);
    // the engine's own stop (nothing of ours above the filter — Up and
    // Shift+Tab) walks UP and is still denied (the ring never leaves)
    expect(anchored(controller).anchorFocusAttempt(null)).toBe("deny");
    expect(controller.state().selectionId).toBe(second);
    expect(anchored(controller).anchorFocusAttempt(null)).toBe("deny");
    expect(controller.state().selectionId).toBe(first);
  });

  test("a WRAPPING ring reads direction by shortest distance (Up at the top proposes the LAST focusable)", async () => {
    const { controller } = await makeInputController();
    // seat on the filter (the sequence's first element); the engine's ring
    // WRAPS on some builds — Up offers the LAST focusable (the footer's
    // close button), which naive position math reads as BELOW the seat
    expect(anchored(controller).anchorFocusAttempt("settings-close")).toBe("deny");
    // the walk moved UP off the first row — the page TURNS to the previous
    // page's last row (the tab ring cycles), never DOWN into the list
    expect(controller.state().activeTabIndex).toBe(controller.state().tabs.length - 1);
    // a mid-sequence target still reads by raw position (Down's shape)
    expect(anchored(controller).anchorFocusAttempt("settings-tab-0")).toBe("deny");
  });

  test("the picker's wrap: Up from the picker filter proposes picker-back and walks UP", async () => {
    const { controller } = await makeInputController();
    controller.switchTab(1);
    while (controller.state().selectionId !== "level") anchored(controller).anchorMove(1);
    anchored(controller).anchorEnter(); // open the picker (seat: picker-filter, selection 0)
    expect(controller.state().pickerSelection).toBe(0);
    // the picker sequence: filter, pick:0..n, [custom], back — Up wraps to
    // the LAST element; naive math walks DOWN instead
    expect(anchored(controller).anchorFocusAttempt("picker-back")).toBe("deny");
    expect(controller.state().pickerSelection).toBe(0); // already at the top — the up-step clamps
  });

  test("a presetless row opens straight onto the custom value input (no filter to walk)", async () => {
    const { controller } = await makeInputController();
    // `name` — a string with no presets: Enter opens the custom-only picker
    while (controller.state().selectionId !== "name") anchored(controller).anchorMove(1);
    anchored(controller).anchorEnter();
    expect(controller.state().pickingRow?.id).toBe("name");
    // the custom field holds the ring: the drawn seat key is the field itself
    expect(anchored(controller).anchorSeatKey()).toBe("picker-custom");
    // any focus proposal is denied — nothing to walk, nothing to filter
    expect(anchored(controller).anchorFocusAttempt("picker-back")).toBe("deny");
    expect(anchored(controller).anchorSeatKey()).toBe("picker-custom");
    // a submitted custom value lands and closes the picker
    controller.submitCustom("name", "renamed");
    expect(controller.state().pickingRow).toBeNull();
    expect(controller.state().visibleSettings.find((r) => r.id === "name")?.displayValue).toContain("renamed");
  });

  test("anchorFocusAttempt in the picker: options walk, the bottom hands off to the custom value field", async () => {
    const { controller } = await makeInputController();
    controller.switchTab(1);
    // walk to `level` — a string with presets AND a custom value field
    while (controller.state().selectionId !== "level") anchored(controller).anchorMove(1);
    anchored(controller).anchorEnter(); // open the picker (ring on picker-filter)
    expect(controller.state().pickingRow).not.toBeNull();
    // Down from the picker filter proposes the first option (after it) —
    // each proposal walks down one (the selection starts at 0; three presets)
    expect(controller.state().pickerSelection).toBe(0);
    expect(anchored(controller).anchorFocusAttempt("pick:0")).toBe("deny");
    expect(controller.state().pickerSelection).toBe(1);
    expect(anchored(controller).anchorFocusAttempt("pick:0")).toBe("deny");
    expect(controller.state().pickerSelection).toBe(2); // the last option
    // the bottom edge hands the keyboard to the custom value field: the
    // host redirects the ring there (typing lands in the field)
    expect(anchored(controller).anchorFocusAttempt("pick:0")).toBe("redirect:picker-custom");
    // from the custom field the arrows hand the keyboard BACK to the
    // filter (its Enter submits the value; Esc closes the picker)
    const back = anchored(controller).anchorFocusAttempt("pick:0");
    expect(back.startsWith("redirect:picker-filter:")).toBe(true);
    // seated again at the (unchanged) last option: Up walks, Down re-hands
    expect(anchored(controller).anchorFocusAttempt(null)).toBe("deny");
    expect(controller.state().pickerSelection).toBe(1);
    expect(anchored(controller).anchorFocusAttempt("pick:0")).toBe("deny");
    expect(controller.state().pickerSelection).toBe(2);
    expect(anchored(controller).anchorFocusAttempt("pick:0")).toBe("redirect:picker-custom");
    // Up at the picker's top does nothing (no wrap): reopen fresh
    controller.closePicker();
    anchored(controller).anchorEnter();
    expect(controller.state().pickerSelection).toBe(0);
    expect(anchored(controller).anchorFocusAttempt(null)).toBe("deny");
    expect(controller.state().pickerSelection).toBe(0);
  });

  test("the custom value field returns the keyboard on arrows (any proposal re-seats the picker filter)", async () => {
    const { controller } = await makeInputController();
    controller.switchTab(1);
    while (controller.state().selectionId !== "level") anchored(controller).anchorMove(1);
    anchored(controller).anchorEnter();
    // walk to the bottom and hand the keyboard to the custom field
    for (let i = 0; i < 2; i += 1) anchored(controller).anchorFocusAttempt("pick:0");
    expect(anchored(controller).anchorFocusAttempt("pick:0")).toBe("redirect:picker-custom");
    // arrows from the custom field bring the ring BACK to the picker
    // filter — the field is a one-way excursion (printables, Enter, Esc
    // stay in it; Up/Down re-seat the anchored filter)
    const back = anchored(controller).anchorFocusAttempt("pick:0");
    expect(back.startsWith("redirect:picker-filter:")).toBe(true);
    // seated again — still at the LAST option: another Down re-hands to
    // the custom field; Up walks away from the edge first
    expect(anchored(controller).anchorFocusAttempt("pick:0")).toBe("redirect:picker-custom");
    expect(anchored(controller).anchorFocusAttempt(null).startsWith("redirect:picker-filter:")).toBe(true);
    expect(anchored(controller).anchorFocusAttempt(null)).toBe("deny");
    expect(controller.state().pickerSelection).toBe(1);
    expect(anchored(controller).anchorFocusAttempt("pick:0")).toBe("deny");
    expect(controller.state().pickerSelection).toBe(2);
    // any proposal FROM the custom seat re-seats — a target below it,
    // and the engine's stop above:
    expect(anchored(controller).anchorFocusAttempt("picker-custom")).toBe("allow");
    expect(anchored(controller).anchorFocusAttempt("picker-back").startsWith("redirect:picker-filter:")).toBe(true);
    expect(anchored(controller).anchorFocusAttempt("picker-custom")).toBe("allow");
    expect(anchored(controller).anchorFocusAttempt(null).startsWith("redirect:picker-filter:")).toBe(true);
  });

  test("the anchored seat key follows the epochs (the drawn keys, never a stale one)", async () => {
    const { controller } = await makeInputController();
    const seat = () => (controller as unknown as { anchorSeatKey?: () => string }).anchorSeatKey?.();
    expect(seat()).toBe("settings-filter:0");
    // a submit bumps the filter epoch — and Enter in the anchored model
    // also OPENS the selection row's picker
    controller.submitFilter("na");
    expect(seat()?.startsWith("picker-filter:")).toBe(true);
    controller.closePicker();
    // after ANY close the seat returns to the main filter — with the
    // CURRENT epoch (the host refocuses this key; a stale one drops the
    // keyboard out of the pane)
    expect(seat()).toBe("settings-filter:1");
    // reopen on the Models page and walk: the seat reads correctly again
    // (clear the "na" filter first — it empties the Models page)
    controller.setFilter("");
    controller.switchTab(1);
    while (controller.state().selectionId !== "level") anchored(controller).anchorMove(1);
    anchored(controller).anchorEnter();
    expect(seat()?.startsWith("picker-filter:")).toBe(true);
    // a CHOICE closes the picker and the seat returns with the epoch
    controller.pickPreset("level", "High");
    expect(seat()).toBe("settings-filter:1");
    expect(anchored(controller).anchorFocusAttempt("settings-tab-0")).toBe("deny");
    // the choice kept the selection on the edited row (the page's last) —
    // the +1 walk turned the page back to General's first row
    expect(controller.state().activeTabIndex).toBe(0);
    expect(controller.state().selectionId).toBe("enabled");
  });

  test("the pager pair and the save chords: pageTurn cycles pages; save buttons carry the engine save chord", async () => {
    const { controller, handle } = await makeController();
    // the tree carries the chord bindings
    const ELEMENTS = {
      Box: (props: Record<string, unknown>) => ({ type: "Box", ...props }),
      Text: (props: Record<string, unknown>) => ({ type: "Text", ...props }),
      Button: (props: Record<string, unknown>) => ({ type: "Button", ...props }),
      Input: (props: Record<string, unknown>) => ({ type: "Input", ...props }),
      Select: (props: Record<string, unknown>) => ({ type: "Select", ...props }),
    };
    const tree = JSON.stringify(buildPaneTree(ELEMENTS as never, controller, { bodyColumns: 80 }));
    expect(tree).toContain('"key":"settings-page-prev"');
    expect(tree).toContain('"action":"chat:undo"');
    expect(tree).toContain('"key":"settings-page-next"');
    expect(tree).toContain('"action":"chat:newline"');
    // the save chords: ctrl+s lands on save-project; save-global carries
    // an unbound engine action (ctrl+shift+s — the pane's shipped entry)
    expect(tree).toContain('"key":"settings-save-project","label":"Save project"');
    expect((tree.match(/"action":"chat:stash"/g) ?? []).length).toBe(1);
    expect(tree).toContain('"action":"chat:clearInput"');
    // the legend row: the receiver glyphs + the keybind note
    expect(tree).toContain('"key":"settings-legend"');
    expect(tree).toContain("Ctrl+G: save global");
    expect(tree).toContain("switch tab");
    // pageTurn cycles pages and parks the selection
    const c2 = await makeInputController();
    c2.controller.pageTurn(1);
    expect(c2.controller.state().activeTabIndex).toBe(1);
    expect(c2.controller.state().selectionId).toBe(c2.controller.state().visibleSettings[0]?.id);
    c2.controller.pageTurn(-1);
    expect(c2.controller.state().activeTabIndex).toBe(0);
    // the DIRECT turn (the chord receivers) lands on the FIRST row even
    // when going backwards — a jump, not a walk continuation
    const c3 = await makeInputController();
    (c3.controller as unknown as { pageTurnDirect: (d: 1 | -1) => void }).pageTurnDirect(-1);
    expect(c3.controller.state().activeTabIndex).toBe((c3.controller.state().tabs.length ?? 1) - 1);
    expect(c3.controller.state().selectionId).toBe(c3.controller.state().visibleSettings[0]?.id);
    void handle;
  });

  test("a preset-only picker (no custom value field) stops dead at its bottom edge", async () => {
    const { controller } = await makeInputController();
    // `enabled` — boolean: presets true/false, no custom value field
    expect(controller.state().selectionId).toBe("enabled");
    anchored(controller).anchorEnter();
    expect(controller.state().pickingRow).not.toBeNull();
    expect(controller.state().pickerSelection).toBe(0);
    expect(anchored(controller).anchorFocusAttempt("pick:0")).toBe("deny");
    expect(controller.state().pickerSelection).toBe(1); // the last option
    // nothing beyond the bottom — the walk stops (no custom field to take over)
    expect(anchored(controller).anchorFocusAttempt("pick:0")).toBe("deny");
    expect(controller.state().pickerSelection).toBe(1);
    // the custom field is not drawn for a closed-enum row — never takes the ring
    expect(anchored(controller).anchorFocusAttempt("picker-custom")).toBe("deny");
    expect(controller.state().pickerSelection).toBe(1);
  });

  test("the anchored API is always present (the ring model is gone)", async () => {
    const { controller } = await makeController();
    expect(typeof controller.anchorMove).toBe("function");
    expect(typeof controller.anchorEnter).toBe("function");
    expect(controller.state().selectionId).toBe(controller.state().visibleSettings[0]?.id ?? null);
  });

  test("typed helper: the anchored API exists on input-mode controllers", async () => {
    const { controller } = await makeInputController();
    const anchored = controller as PaneController & {
      anchorMove: (delta: 1 | -1) => void;
      anchorEnter: () => void;
      anchorFocusAttempt: (key: string | null) => "allow" | "deny";
    };
    expect(typeof anchored.anchorMove).toBe("function");
    anchored.anchorMove(1);
    expect(anchored.anchorFocusAttempt("settings-filter")).toBe("allow");
  });
});
