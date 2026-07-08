// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Tests for registerSettingsCommand and openSettingsModal.
 *
 * Verifies command registration, session_start handler, and env var serialization.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresetPair, SettingsSchema } from "../src/schema.js";
import {
  openSettingsModal,
  registerSettingsCommand,
  type SettingsHandle,
  type SettingsHandleInternal,
} from "../src/ui/settings-command.js";

/** No value (nullable setting) */
const NO_VALUE: unknown = null;

/** Setting value: disabled */
const SETTING_DISABLED = false;

// Mock SettingsTabsModal so openSettingsModal factory can run without real TUI
vi.mock("../src/ui/settings-modal.js", () => {
  const MockSettingsTabsModal = class {
    render = vi.fn(() => []);
    invalidate = vi.fn();
    handleInput = vi.fn();
    syncActiveTab = vi.fn();
  };
  const MockFn = MockSettingsTabsModal as unknown as (...args: unknown[]) => unknown;
  return { SettingsTabsModal: vi.fn().mockImplementation(MockFn) };
});

// Mock ModalFrame so the factory can run without the real frame; individual tests can override
// the implementation to capture constructor opts (e.g. helpText).
vi.mock("../src/ui/modal-frame.js", () => {
  const MockModalFrame = class {
    render = vi.fn(() => []);
    invalidate = vi.fn();
  };
  const MockFn = MockModalFrame as unknown as (...args: unknown[]) => unknown;
  return { ModalFrame: vi.fn().mockImplementation(MockFn) };
});

const TEST_SCHEMA: SettingsSchema = {
  settings: [
    {
      id: "testSetting",
      label: "Test Setting",
      type: "string",
      defaultValue: "default",
    },
  ],
  tabs: [{ label: "Test", settingIds: ["testSetting"] }],
  globalPath: () => "/tmp/test.json",
  projectPath: () => "/tmp/test.json",
};

function createMockHandle(): SettingsHandleInternal {
  return {
    getSettings: vi.fn(() => ({ testSetting: "default" })),
    updateSetting: vi.fn(),
    loadSettingsIntoMemory: vi.fn(),
    saveGlobalSettings: vi.fn(),
    saveProjectSettings: vi.fn(),
    computeDefaults: vi.fn(() => ({ testSetting: "default" })),
    schema: TEST_SCHEMA,
    storageLevels: ["session", "project", "global"],
  };
}

// a typed handle (interface without string index signature) must be assignable to
// registerSettingsCommand/openSettingsModal (which accept SettingsHandle<S>). This is a
// compile-time guard: if the generic constraint or SettingsHandle<S> regresses (e.g. S
// constrained to Record<string,unknown>, or SettingsHandle left non-generic), this stops
// typechecking. (Mirrors unstuck's createSettingsExtension<UnstuckSettings> usage)
// Compile-time guard: registerSettingsCommand<S> returns SettingsHandle<S> with typed
// getSettings — mirrors consumer usage like registerSettingsCommand<SubagentSettings>(...).
it("registerSettingsCommand<S> returns a typed SettingsHandle<S>", () => {
  interface CountSettings {
    count: number;
  }
  const countSchema: SettingsSchema = {
    settings: [{ id: "count", label: "Count", type: "number", defaultValue: 7 }],
    tabs: [{ label: "General", settingIds: ["count"] }],
    globalPath: () => "/tmp/test-count.json",
    projectPath: () => "/tmp/test-count.json",
  };
  const handle = registerSettingsCommand<CountSettings>(createMockPi(), countSchema, {
    commandName: "typed-settings",
    title: "Typed",
  });
  // If this compiles, getSettings is typed as CountSettings (no cast needed).
  expect(handle.getSettings().count).toBe(7);
});

function createMockPi() {
  const commands = new Map<
    string,
    { description: string; handler: (args: unknown[], ctx: unknown) => Promise<void> }
  >();
  const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const events = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      const list = handlers.get(`event:${event}`) ?? [];
      list.push(handler);
      handlers.set(`event:${event}`, list);
      return () => {}; // unsubscribe
    }),
  };

  return {
    registerCommand: vi.fn(
      (
        name: string,
        opts: { description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
      ) => {
        commands.set(
          name,
          opts as unknown as { description: string; handler: (args: unknown[], ctx: unknown) => Promise<void> },
        );
      },
    ),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void | Promise<void>) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    events,
    commands,
    handlers,
    fireSessionEvent: (event: string, ...args: unknown[]) => {
      const list = handlers.get(event) ?? [];
      for (const h of list) h(...args);
    },
  } as unknown as ExtensionAPI & {
    events: typeof events;
    commands: typeof commands;
    handlers: typeof handlers;
    fireSessionEvent: (event: string, ...args: unknown[]) => void;
  };
}

describe("registerSettingsCommand", () => {
  let handle: SettingsHandle;
  let pi: ReturnType<typeof createMockPi>;

  beforeEach(() => {
    pi = createMockPi();
    delete process.env.PI_TEST_SETTINGS;
  });

  it("registers the command with correct name and description", () => {
    handle = registerSettingsCommand(pi, TEST_SCHEMA, {
      commandName: "test-settings",
      title: "Test Settings",
      titleRight: "test",
    });

    expect(pi.registerCommand).toHaveBeenCalledWith(
      "test-settings",
      expect.objectContaining({
        description: "Configure Test Settings",
      }),
    );
  });

  it("auto-loads settings at registration (process.cwd) — no manual startup call needed", () => {
    // envVar is serialized inside loadSettingsIntoMemory (only when `session` is a level, which
    // the default storageLevels includes). A set env var proves load ran at registration.
    handle = registerSettingsCommand(pi, TEST_SCHEMA, {
      commandName: "test-settings",
      title: "Test Settings",
      envVar: "PI_TEST_SETTINGS",
    });

    expect(process.env.PI_TEST_SETTINGS).toEqual(expect.any(String));
  });

  it("registers session_start handler", () => {
    handle = registerSettingsCommand(pi, TEST_SCHEMA, {
      commandName: "test-settings",
      title: "Test Settings",
    });

    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
  });

  it("session_start handler re-loads settings with the session cwd", () => {
    handle = registerSettingsCommand(pi, TEST_SCHEMA, {
      commandName: "test-settings",
      title: "Test Settings",
    });

    // spy AFTER registration (load already ran); session_start should call it again
    const spy = vi.spyOn(handle as unknown as SettingsHandleInternal, "loadSettingsIntoMemory");
    pi.fireSessionEvent("session_start", {}, { cwd: "/tmp" });

    expect(spy).toHaveBeenCalledWith("/tmp", undefined);
  });

  it("session_start without a cwd does not re-load", () => {
    handle = registerSettingsCommand(pi, TEST_SCHEMA, {
      commandName: "test-settings",
      title: "Test Settings",
    });

    const spy = vi.spyOn(handle as unknown as SettingsHandleInternal, "loadSettingsIntoMemory");
    pi.fireSessionEvent("session_start", {}, {});

    expect(spy).not.toHaveBeenCalled();
  });

  it("returns a usable handle (getSettings reflects loaded defaults)", () => {
    handle = registerSettingsCommand(pi, TEST_SCHEMA, {
      commandName: "test-settings",
      title: "Test Settings",
    });

    expect(handle.getSettings().testSetting).toBe("default");
  });

  it("command handler calls openSettingsModal with correct options", async () => {
    const mockCtx = {
      hasUI: true,
      ui: { notify: vi.fn(), custom: vi.fn(async () => {}) },
    };

    handle = registerSettingsCommand(pi, TEST_SCHEMA, {
      commandName: "test-settings",
      title: "Test Settings",
      titleRight: "test",
    });

    const cmd = pi.commands.get("test-settings");
    expect(cmd).toBeDefined();

    if (!cmd) return;
    await cmd.handler([], mockCtx);

    expect(mockCtx.ui.custom).toHaveBeenCalled();
  });

  it("command handler warns when hasUI is false", async () => {
    const mockCtx = {
      hasUI: false,
      ui: { notify: vi.fn(), custom: vi.fn(async () => {}) },
    };

    handle = registerSettingsCommand(pi, TEST_SCHEMA, {
      commandName: "test-settings",
      title: "Test Settings",
    });

    const cmd = pi.commands.get("test-settings");
    expect(cmd).toBeDefined();

    if (!cmd) return;
    await cmd.handler([], mockCtx);

    expect(mockCtx.ui.notify).toHaveBeenCalledWith("/test-settings requires interactive TUI mode.", "warning");
  });

  it("beforeOpen hook is called before opening modal", async () => {
    const beforeOpen = vi.fn();
    const mockCtx = {
      hasUI: true,
      ui: { notify: vi.fn(), custom: vi.fn(async () => {}) },
    };

    handle = registerSettingsCommand(pi, TEST_SCHEMA, {
      commandName: "test-settings",
      title: "Test Settings",
      beforeOpen,
    });

    const cmd = pi.commands.get("test-settings");
    expect(cmd).toBeDefined();

    if (!cmd) return;
    await cmd.handler([], mockCtx);

    expect(beforeOpen).toHaveBeenCalledWith(mockCtx);
  });
});

/** Captures onChange + handleInput from the openSettingsModal factory. */
async function openModalAndCapture(
  handle: SettingsHandleInternal,
  options: Parameters<typeof openSettingsModal>[2],
): Promise<{
  onChange: ((id: string, value: unknown) => void) | null;
  handleInput: ((data: string) => void) | null;
  helpText: string | null;
}> {
  let capturedOnChange: ((id: string, value: unknown) => void) | null = null;
  let capturedHandleInput: ((data: string) => void) | null = null;
  let capturedHelpText: string | null = null;
  const { SettingsTabsModal } = await import("../src/ui/settings-modal.js");
  (SettingsTabsModal as ReturnType<typeof vi.fn>).mockImplementation(
    class MockSettingsTabsModal {
      constructor(opts: { onChange: ((id: string, newValue: unknown) => void) | null }) {
        capturedOnChange = opts.onChange ?? null;
      }
      render = vi.fn(() => []);
      invalidate = vi.fn();
      handleInput = vi.fn();
      syncActiveTab = vi.fn();
    },
  );
  const { ModalFrame } = await import("../src/ui/modal-frame.js");
  (ModalFrame as ReturnType<typeof vi.fn>).mockImplementationOnce(
    class MockModalFrame {
      constructor(opts: { helpText: string }) {
        capturedHelpText = opts.helpText;
      }
      render = vi.fn(() => []);
    },
  );
  const mockCtx = {
    hasUI: true,
    ui: {
      notify: vi.fn(),
      custom: vi.fn(async (factory: (...args: unknown[]) => unknown) => {
        const result = (await factory({ requestRender: vi.fn() }, {}, {}, () => {})) as {
          handleInput: (data: string) => void;
        };
        capturedHandleInput = result.handleInput;
      }),
    },
  };
  await openSettingsModal(mockCtx as unknown as ExtensionCommandContext, handle, options);
  return { onChange: capturedOnChange, handleInput: capturedHandleInput, helpText: capturedHelpText };
}

// ── onChange: updateSetting + onAfterChange (persistence is the factory's job, not the modal's) ──
describe("onChange callback in openSettingsModal", () => {
  it("calls handle.updateSetting (no env-var / auto-persist in the modal — factory owns persistence)", async () => {
    const handle = createMockHandle();
    const { onChange } = await openModalAndCapture(handle, {
      commandName: "test-settings",
      title: "Test Settings",
    });
    expect(onChange).not.toBeNull();
    if (!onChange) return;
    onChange("testSetting", "newvalue");
    expect(handle.updateSetting).toHaveBeenCalledWith("testSetting", "newvalue");
  });

  it("onChange passes raw typed values (number, boolean, null) to updateSetting", async () => {
    const handle = createMockHandle();
    const { onChange } = await openModalAndCapture(handle, {
      commandName: "test-settings",
      title: "Test Settings",
    });
    expect(onChange).not.toBeNull();
    if (!onChange) return;
    (onChange as (id: string, newValue: number) => void)("timeout", 300000);
    expect(handle.updateSetting).toHaveBeenCalledWith("timeout", 300000);
    (onChange as (id: string, newValue: boolean) => void)("enabled", SETTING_DISABLED);
    expect(handle.updateSetting).toHaveBeenCalledWith("enabled", false);
    (onChange as (id: string, newValue: unknown) => void)("nullable", NO_VALUE);
    expect(handle.updateSetting).toHaveBeenCalledWith("nullable", NO_VALUE);
  });

  it("calls onAfterChange hook after update", async () => {
    const handle = createMockHandle();
    const afterChangeFn = vi.fn();
    const { onChange } = await openModalAndCapture(handle, {
      commandName: "test-settings",
      title: "Test Settings",
      onAfterChange: afterChangeFn,
    });
    expect(onChange).not.toBeNull();
    if (!onChange) return;
    (onChange as (id: string, newValue: string) => void)("testSetting", "newvalue");
    expect(afterChangeFn).toHaveBeenCalledWith("testSetting", "newvalue");
  });

  it("notifies the user when a resolver throws (failedIds → ui.notify)", async () => {
    const resolverSchema: SettingsSchema = {
      settings: [
        {
          id: "pick",
          label: "Pick",
          type: "string",
          defaultValue: "a",
          presets: (): PresetPair[] => {
            throw new Error("boom");
          },
        },
      ],
      tabs: [{ label: "T", settingIds: ["pick"] }],
      globalPath: () => "/tmp/test.json",
      projectPath: () => "/tmp/test.json",
    };
    const handle = createMockHandle();
    (handle as unknown as { schema: SettingsSchema }).schema = resolverSchema;

    const notify = vi.fn();
    const mockCtx = {
      hasUI: true,
      ui: {
        notify,
        custom: vi.fn(async (factory: (...args: unknown[]) => unknown) => {
          await factory({ requestRender: vi.fn() }, {}, {}, () => {});
        }),
      },
    };

    await openSettingsModal(mockCtx as unknown as ExtensionCommandContext, handle, {
      commandName: "test-settings",
      title: "Test Settings",
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const [message, type] = notify.mock.calls[0] ?? [];
    expect(type).toBe("warning");
    expect(String(message)).toContain("⚠");
    expect(String(message)).toContain("pick");
  });
});

// ── storage levels are inherited from the handle (the factory is the source of truth) ──
describe("storageLevels inheritance + save-key gating", () => {
  const CTRL_S = "\x13";
  const CTRL_D = "\x04";
  function handleWithLevels(levels: string[]): SettingsHandleInternal {
    const h = createMockHandle();
    (h as unknown as { storageLevels: string[] }).storageLevels = levels;
    return h;
  }

  it("default (session+project+global): Ctrl+S saves project, Ctrl+D saves global; onChange in-memory", async () => {
    const handle = handleWithLevels(["session", "project", "global"]);
    (handle.getSettings as ReturnType<typeof vi.fn>).mockReturnValue({ testSetting: "updated" });
    const { onChange, handleInput } = await openModalAndCapture(handle, {
      commandName: "test-settings",
      title: "Test",
    });
    expect(onChange).not.toBeNull();
    if (!onChange) return;
    onChange("testSetting", "newvalue");
    // multi-level buffer mode: onChange updates the buffer only (no immediate file write)
    expect(handle.saveGlobalSettings).not.toHaveBeenCalled();
    expect(handle.saveProjectSettings).not.toHaveBeenCalled();
    expect(handleInput).not.toBeNull();
    if (!handleInput) return;
    handleInput(CTRL_S);
    expect(handle.saveProjectSettings).toHaveBeenCalledWith({ testSetting: "updated" }, expect.any(String));
    handleInput(CTRL_D);
    expect(handle.saveGlobalSettings).toHaveBeenCalledWith({ testSetting: "updated" });
  });

  it("[project,global] (no session): both Ctrl+S + Ctrl+D active; onChange in-memory", async () => {
    const handle = handleWithLevels(["project", "global"]);
    (handle.getSettings as ReturnType<typeof vi.fn>).mockReturnValue({ testSetting: "v" });
    const { onChange, handleInput } = await openModalAndCapture(handle, {
      commandName: "test-settings",
      title: "Test",
    });
    expect(onChange).not.toBeNull();
    if (!onChange) return;
    onChange("testSetting", "v");
    expect(handle.saveProjectSettings).not.toHaveBeenCalled();
    expect(handle.saveGlobalSettings).not.toHaveBeenCalled();
    expect(handleInput).not.toBeNull();
    if (!handleInput) return;
    handleInput(CTRL_S);
    expect(handle.saveProjectSettings).toHaveBeenCalled();
    handleInput(CTRL_D);
    expect(handle.saveGlobalSettings).toHaveBeenCalled();
  });

  it("[global] single-level: no save-keys (updateSetting writes directly); Ctrl+S/D are no-ops", async () => {
    const handle = handleWithLevels(["global"]);
    (handle.getSettings as ReturnType<typeof vi.fn>).mockReturnValue({ testSetting: "v" });
    const { onChange, handleInput } = await openModalAndCapture(handle, {
      commandName: "test-settings",
      title: "Test",
    });
    expect(onChange).not.toBeNull();
    if (!onChange) return;
    onChange("testSetting", "v");
    // single-level: the modal adds NO persistence (updateSetting writes the file itself)
    expect(handle.saveGlobalSettings).not.toHaveBeenCalled();
    expect(handle.saveProjectSettings).not.toHaveBeenCalled();
    expect(handleInput).not.toBeNull();
    if (!handleInput) return;
    handleInput(CTRL_S);
    handleInput(CTRL_D);
    expect(handle.saveProjectSettings).not.toHaveBeenCalled();
    expect(handle.saveGlobalSettings).not.toHaveBeenCalled();
  });

  it("[session] single-level: no save-keys (in-memory only); Ctrl+S/D no-ops", async () => {
    const handle = handleWithLevels(["session"]);
    const { onChange, handleInput } = await openModalAndCapture(handle, {
      commandName: "test-settings",
      title: "Test",
    });
    expect(onChange).not.toBeNull();
    if (!onChange) return;
    onChange("testSetting", "v");
    expect(handle.saveGlobalSettings).not.toHaveBeenCalled();
    expect(handle.saveProjectSettings).not.toHaveBeenCalled();
    expect(handleInput).not.toBeNull();
    if (!handleInput) return;
    handleInput(CTRL_S);
    handleInput(CTRL_D);
    expect(handle.saveProjectSettings).not.toHaveBeenCalled();
    expect(handle.saveGlobalSettings).not.toHaveBeenCalled();
  });

  it("help-text inherits the handle's storageLevels (single global → auto-persist note)", async () => {
    const handle = handleWithLevels(["global"]);
    const { helpText } = await openModalAndCapture(handle, {
      commandName: "test-settings",
      title: "Test",
    });
    expect(helpText).toContain("Changes save to global automatically");
    expect(helpText).toContain("Tab/Shift+Tab");
  });

  it("help-text for multi-level → save-key hint", async () => {
    const handle = handleWithLevels(["session", "project", "global"]);
    const { helpText } = await openModalAndCapture(handle, {
      commandName: "test-settings",
      title: "Test",
    });
    expect(helpText).toContain("Ctrl+S: save project");
    expect(helpText).toContain("Ctrl+D: save global");
  });
});

describe("normalizeStorageLevels", () => {
  it("undefined to default (all three)", async () => {
    const { normalizeStorageLevels } = await import("../src/ui/settings-command.js");
    expect(normalizeStorageLevels(undefined)).toEqual(["session", "project", "global"]);
  });
  it("empty array to default (all three)", async () => {
    const { normalizeStorageLevels } = await import("../src/ui/settings-command.js");
    expect(normalizeStorageLevels([])).toEqual(["session", "project", "global"]);
  });
  it("dedups duplicates", async () => {
    const { normalizeStorageLevels } = await import("../src/ui/settings-command.js");
    expect(normalizeStorageLevels(["global", "global"])).toEqual(["global"]);
  });
  it("drops typos and falls to default when nothing valid remains", async () => {
    const { normalizeStorageLevels } = await import("../src/ui/settings-command.js");
    const input = ["Session", "local"] as unknown as ("session" | "project" | "global")[];
    expect(normalizeStorageLevels(input)).toEqual(["session", "project", "global"]);
  });
  it("drops invalid entries but keeps valid ones", async () => {
    const { normalizeStorageLevels } = await import("../src/ui/settings-command.js");
    const input = ["global", "bad"] as unknown as ("session" | "project" | "global")[];
    expect(normalizeStorageLevels(input)).toEqual(["global"]);
  });
  it("preserves valid multi-level subsets unchanged", async () => {
    const { normalizeStorageLevels } = await import("../src/ui/settings-command.js");
    expect(normalizeStorageLevels(["project", "global"])).toEqual(["project", "global"]);
  });
  it("preserves the FIRST-occurrence order (does not canonicalize)", async () => {
    const { normalizeStorageLevels } = await import("../src/ui/settings-command.js");
    expect(normalizeStorageLevels(["global", "session"])).toEqual(["global", "session"]);
  });
});

describe("buildHelpText", () => {
  const NAV = "Esc | ↑↓: navigate | ←→: filter cursor | Tab/Shift+Tab: switch tab | Enter: change";
  it("single level (global) -> nav + auto-persist note", async () => {
    const { buildHelpText } = await import("../src/ui/settings-command.js");
    expect(buildHelpText(["global"])).toBe(`${NAV} · Changes save to global automatically`);
  });
  it("single level (session) -> nav + session auto-persist note", async () => {
    const { buildHelpText } = await import("../src/ui/settings-command.js");
    expect(buildHelpText(["session"])).toBe(`${NAV} · Changes save to session automatically`);
  });
  it("single level (project) -> nav + project auto-persist note", async () => {
    const { buildHelpText } = await import("../src/ui/settings-command.js");
    expect(buildHelpText(["project"])).toBe(`${NAV} · Changes save to project automatically`);
  });
  it("default (all three) -> nav + project + global save keys", async () => {
    const { buildHelpText } = await import("../src/ui/settings-command.js");
    expect(buildHelpText(["session", "project", "global"])).toBe(`${NAV} | Ctrl+S: save project | Ctrl+D: save global`);
  });
  it("[project,global] -> nav + both save keys (no session key)", async () => {
    const { buildHelpText } = await import("../src/ui/settings-command.js");
    expect(buildHelpText(["project", "global"])).toBe(`${NAV} | Ctrl+S: save project | Ctrl+D: save global`);
  });
  it("[session,project] -> nav + project save key only", async () => {
    const { buildHelpText } = await import("../src/ui/settings-command.js");
    expect(buildHelpText(["session", "project"])).toBe(`${NAV} | Ctrl+S: save project`);
  });
  it("[session,global] -> nav + global save key only", async () => {
    const { buildHelpText } = await import("../src/ui/settings-command.js");
    expect(buildHelpText(["session", "global"])).toBe(`${NAV} | Ctrl+D: save global`);
  });
});
