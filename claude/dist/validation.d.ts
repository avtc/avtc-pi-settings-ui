/**
 * Validation helpers for settings values.
 *
 * Generic parsing/formatting primitives (durations, compact thresholds) consumed by the
 * built-in `TypeDefinition`s (type-definitions.ts) and re-exported for legacy direct use.
 */
/** Parse human-readable duration (e.g. "5m", "90s", "500ms") to milliseconds. Returns undefined for invalid/zero/negative. (invalid → undefined, never null — null is a preset value owned by the gate's null-label step) */
export declare function parseHumanDuration(input: string): number | undefined;
/** Format milliseconds as a human-readable duration string (e.g. "5m", "90s", "500ms", "Infinite").
 *  Uses the largest unit where value >= 1, with clean fractions (0 or.5) for minutes/hours.
 *  Ensures parseHumanDuration(formatHumanDuration(ms)) round-trips correctly.
 */
export declare function formatHumanDuration(ms: number | null): string;
/** Parse a compact threshold number input (e.g. "300") to internal format ("compact>300K"). Returns undefined for invalid. (invalid → undefined, never null) */
export declare function parseCompactThreshold(input: string): string | undefined;
/** Format compact threshold internal value to pre-fill string. Returns "" for non-threshold values. */
export declare function formatCompactThreshold(value: string): string;
/** Is `value` a canonical `compact>NK` threshold string? Single source for the format contract. */
export declare function isCompactThreshold(value: string): boolean;
