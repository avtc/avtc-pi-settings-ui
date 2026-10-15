// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>
/** The full set of levels, in canonical order. */
export const DEFAULT_STORAGE_LEVELS = ["session", "project", "global"];
/** Valid level strings (for normalization / typo rejection). */
export const VALID_STORAGE_LEVELS = new Set(DEFAULT_STORAGE_LEVELS);
/**
 * Normalize a consumer-supplied `storageLevels`: drop unknown/duplicate entries, fall back to
 * the full default set when nothing valid remains. Deduping/validating BEFORE the count rule
 * prevents duplicates or typos from silently flipping single-level → multi-level mode.
 */
export function normalizeStorageLevels(levels) {
    if (!levels || levels.length === 0)
        return [...DEFAULT_STORAGE_LEVELS];
    const seen = new Set();
    const out = [];
    for (const level of levels) {
        if (VALID_STORAGE_LEVELS.has(level) && !seen.has(level)) {
            seen.add(level);
            out.push(level);
        }
    }
    return out.length > 0 ? out : [...DEFAULT_STORAGE_LEVELS];
}
