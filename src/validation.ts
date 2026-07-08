// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Validation helpers for settings values.
 *
 * Generic parsing/formatting primitives (durations, compact thresholds) consumed by the
 * built-in `TypeDefinition`s (type-definitions.ts) and re-exported for legacy direct use.
 */

// ── Duration helpers ─────────────────────────────────────────────────────────

/** Parse human-readable duration (e.g. "5m", "90s", "500ms") to milliseconds. Returns undefined for invalid/zero/negative. (invalid → undefined, never null — null is a preset value owned by the gate's null-label step) */
export function parseHumanDuration(input: string): number | undefined {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/);
  if (!match) return undefined;
  const num = parseFloat(match[1]);
  const unit = match[2];
  let ms: number;
  switch (unit) {
    case "ms":
      ms = num;
      break;
    case "s":
      ms = Math.round(num * 1000);
      break;
    case "m":
      ms = Math.round(num * 60_000);
      break;
    case "h":
      ms = Math.round(num * 3_600_000);
      break;
    case "d":
      ms = Math.round(num * 86_400_000);
      break;
    default:
      return undefined;
  }
  return ms;
}

/** Format milliseconds as a human-readable duration string (e.g. "5m", "90s", "500ms", "Infinite").
 *  Uses the largest unit where value >= 1, with clean fractions (0 or.5) for minutes/hours.
 *  Ensures parseHumanDuration(formatHumanDuration(ms)) round-trips correctly.
 */
export function formatHumanDuration(ms: number | null): string {
  if (ms === null) return "Infinite";
  if (ms < 1000) return `${ms}ms`;
  // Days tier (>= 1 day) — only kanban reaches here (1d/7d/30d). Non-integer days fall
  // through to the hours/minutes logic below so they still round-trip via parseHumanDuration.
  if (ms >= 86_400_000) {
    const days = ms / 86_400_000;
    const roundedDays = Math.round(days);
    if (Math.abs(days - roundedDays) < 0.00001) return `${roundedDays}d`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = seconds / 60;
  const roundedMinutes = Math.round(minutes);
  const mfrac = minutes - Math.floor(minutes);
  // Check for half-minute fractions (e.g., 1.5m) — only for < 60 minutes
  if (roundedMinutes < 60 && Math.abs(mfrac - 0.5) < 0.00001) return `${Math.floor(minutes) + 0.5}m`;
  // Check for exact integer hours (e.g., 60m = 1h, 120m = 2h)
  if (roundedMinutes >= 60) {
    const hours = minutes / 60;
    const roundedHours = Math.round(hours);
    const hfrac = hours - Math.floor(hours);
    if (Math.abs(hfrac) < 0.00001 || Math.abs(hfrac - 1) < 0.00001) return `${roundedHours}h`;
    // Non-integer hours: show as minutes
    return `${roundedMinutes}m`;
  }
  // Exact integer minutes
  if (Math.abs(mfrac) < 0.00001 || Math.abs(mfrac - 1) < 0.00001) return `${roundedMinutes}m`;
  // Non-integer, non-half minutes: show as seconds
  return `${Math.floor(seconds)}s`;
}

// ── Compact threshold helpers ────────────────────────────────────────────────

/** Regex matching compact threshold values like "compact>75K". First digit must be 1-9 (no leading zero). */
const COMPACT_THRESHOLD_REGEX = /^compact>([1-9]\d*)K$/;

/** Parse a compact threshold number input (e.g. "300") to internal format ("compact>300K"). Returns undefined for invalid. (invalid → undefined, never null) */
export function parseCompactThreshold(input: string): string | undefined {
  const num = parseInt(input, 10);
  if (Number.isNaN(num) || num < 1) return undefined;
  return `compact>${num}K`;
}

/** Format compact threshold internal value to pre-fill string. Returns "" for non-threshold values. */
export function formatCompactThreshold(value: string): string {
  const match = value.match(COMPACT_THRESHOLD_REGEX);
  return match ? match[1] : "";
}

/** Is `value` a canonical `compact>NK` threshold string? Single source for the format contract. */
export function isCompactThreshold(value: string): boolean {
  return COMPACT_THRESHOLD_REGEX.test(value);
}

// ── Duration/compact PRIMITIVES (parse/format) live here; the TypeDefinition registry sits in
//    type-definitions.ts, and the custom-value VALIDATION that USES the registry lives in
//    custom-validation.ts. This keeps the dependency graph acyclic:
//    custom-validation → type-definitions → (this module's primitives). ────────────────────────

// (parseHumanDuration / formatHumanDuration / parseCompactThreshold / formatCompactThreshold are exported above)
