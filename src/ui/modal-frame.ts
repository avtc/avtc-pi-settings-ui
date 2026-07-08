// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Simple modal frame renderer for pi TUI overlays.
 *
 * Provides title bar, side borders, and optional help text undertitle.
 * Used internally by avtc-pi-settings-ui's openSettingsModal.
 *
 * Usage:
 * ```ts
 * const frame = new ModalFrame({
 *   title: "My Dialog",
 *   content: myContentComponent,
 *   helpText: "Esc: close | Enter: confirm",
 * });
 * ```
 */
import type { Component } from "@earendil-works/pi-tui";

// ── Border characters ──────────────────────────────────────────────────────────

const ROUNDED = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
} as const;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ModalFrameOptions {
  /** Title text displayed in the top border. */
  title: string;
  /** Optional right-aligned subtitle in the top border. */
  titleRight?: string;
  /** Nested content component rendered inside the frame. */
  content: Component;
  /** Optional help text displayed below the bottom border. */
  helpText?: string;
}

// ── ModalFrame ─────────────────────────────────────────────────────────────────

export class ModalFrame implements Component {
  private options: ModalFrameOptions;

  constructor(options: ModalFrameOptions) {
    this.options = options;
  }

  invalidate(): void {
    // ModalFrame has no internal state to invalidate
  }

  render(width: number): string[] {
    const { title, titleRight, content, helpText } = this.options;
    const b = ROUNDED;
    const lines: string[] = [];

    // ── Top border with title ──
    const innerWidth = width - 2; // minus left and right border chars
    const titleStr = title ? ` ${title} ` : "";
    const titleRightStr = titleRight ? ` ${titleRight} ` : "";
    const titleContentLen = titleStr.length + titleRightStr.length;
    const fillLen = Math.max(0, innerWidth - titleContentLen);
    const topLine = `${b.topLeft}${titleStr}${b.horizontal.repeat(fillLen)}${titleRightStr}${b.topRight}`;
    // Pad/truncate to exact width
    lines.push(padToWidth(topLine, width));

    // ── Content ──
    const contentWidth = Math.max(1, innerWidth);
    const contentLines = content.render(contentWidth);
    for (const line of contentLines) {
      // Truncate content line to innerWidth, pad with spaces to fill
      const inner = padToWidth(truncateToWidth(line, contentWidth), contentWidth);
      lines.push(`${b.vertical}${inner}${b.vertical}`);
    }

    // ── Bottom border ──
    lines.push(`${b.bottomLeft}${b.horizontal.repeat(innerWidth)}${b.bottomRight}`);

    // ── Help text undertitle ──
    if (helpText) {
      lines.push(padToWidth(` ${helpText} `, width));
    }

    return lines;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Truncate a string to at most `maxWidth` visible (ANSI-aware) columns. */
function truncateToWidth(text: string, maxWidth: number): string {
  // Strip ANSI escape sequences for width measurement
  // biome-ignore lint/suspicious/noControlCharactersInRegex: legitimate ANSI escape handling
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
  if (stripped.length <= maxWidth) return text;
  // Find cut point in original string where visible chars reach maxWidth
  let visible = 0;
  let i = 0;
  let inEscape = false;
  while (i < text.length && visible < maxWidth) {
    if (text[i] === "\x1b") {
      inEscape = true;
      i++;
      continue;
    }
    if (inEscape) {
      if (text[i] === "m") inEscape = false;
      i++;
      continue;
    }
    visible++;
    i++;
  }
  return text.slice(0, i);
}

/** Pad a string with spaces to exactly `width` visible columns. */
function padToWidth(text: string, width: number): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: legitimate ANSI escape handling
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
  const visibleLen = stripped.length;
  if (visibleLen >= width) return text;
  return text + " ".repeat(width - visibleLen);
}
