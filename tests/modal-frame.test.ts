// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import { ModalFrame } from "../src/ui/modal-frame.js";

/** Simple stub component that returns fixed lines. */
class StubContent implements Component {
  constructor(private lines: string[]) {}
  render(_width: number): string[] {
    return this.lines;
  }
  invalidate = vi.fn();
}

describe("ModalFrame", () => {
  test("renders title bar with rounded corners", () => {
    const frame = new ModalFrame({
      title: "Test Title",
      content: new StubContent(["Hello"]),
    });
    const lines = frame.render(40);
    // Top border: ╭ Test Title ───────────────╮
    expect(lines[0]).toMatch(/^╭ Test Title .*╮$/);
    // Content line wrapped in borders
    expect(lines[1]).toMatch(/^│.*Hello.*│$/);
    // Bottom border
    expect(lines[2]).toMatch(/^╰─+╯$/);
  });

  test("renders title bar with right-aligned subtitle", () => {
    const frame = new ModalFrame({
      title: "Left",
      titleRight: "Right",
      content: new StubContent(["content"]),
    });
    const lines = frame.render(30);
    expect(lines[0]).toMatch(/^╭ Left.*Right.*╮$/);
  });

  test("renders help text below bottom border", () => {
    const frame = new ModalFrame({
      title: "Test",
      content: new StubContent(["line"]),
      helpText: "Esc: close | Enter: confirm",
    });
    const lines = frame.render(50);
    // Last line should be the help text
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toContain("Esc: close | Enter: confirm");
  });

  test("pads content lines to fill frame width", () => {
    const frame = new ModalFrame({
      title: "T",
      content: new StubContent(["short"]),
    });
    const width = 40;
    const lines = frame.render(width);
    // Content line should be exactly `width` characters (no ANSI here)
    const contentLine = lines[1];
    expect(contentLine.length).toBe(width);
  });

  test("truncates content lines that exceed frame width", () => {
    const longLine = "x".repeat(200);
    const frame = new ModalFrame({
      title: "T",
      content: new StubContent([longLine]),
    });
    const width = 30;
    const lines = frame.render(width);
    // Content line should be exactly `width` characters
    const contentLine = lines[1];
    expect(contentLine.length).toBe(width);
    // Should start with │ and end with │
    expect(contentLine.startsWith("│")).toBe(true);
    expect(contentLine.endsWith("│")).toBe(true);
  });

  test("handles empty content", () => {
    const frame = new ModalFrame({
      title: "Empty",
      content: new StubContent([]),
    });
    const lines = frame.render(20);
    // Should still have top and bottom borders
    expect(lines[0]).toMatch(/^╭/);
    expect(lines[lines.length - 1]).toMatch(/^╰/);
  });

  test("preserves ANSI escape codes in content", () => {
    const redText = "\x1b[31mRed\x1b[0m";
    const frame = new ModalFrame({
      title: "T",
      content: new StubContent([redText]),
    });
    const width = 20;
    const lines = frame.render(width);
    const contentLine = lines[1];
    // ANSI codes should be preserved
    expect(contentLine).toContain("\x1b[31m");
    expect(contentLine).toContain("Red");
  });
});
