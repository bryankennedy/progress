// Quick-add support for the Agenda view (PROG-89): each date grouping (except
// Overdue) carries an input that creates an action pre-dated for that bucket.
// The date math is pure and lives here so it can be unit-tested; the sticky
// "which focus did I last quick-add into" preference follows the
// outlinePrefs/boardFilters localStorage pattern (fail-soft, never
// load-bearing).

import { addDays, type AgendaBucket } from "./dates";

/**
 * The due date a quick-added action gets for a bucket, relative to local
 * `today`. Buckets are rolling windows (D38), so the defaults are the window's
 * edges: Today → today; This week → today+6 (the last day of the rolling
 * window, "by end of week"); Later → today+7 (the first day beyond it). Each
 * lands the new action in the bucket it was typed under. Overdue has no input —
 * an action can't be born already late — so it maps to null.
 */
export function quickAddDueDate(bucket: AgendaBucket, today: string): string | null {
  switch (bucket) {
    case "today":
      return today;
    case "week":
      return addDays(today, 6);
    case "later":
      return addDays(today, 7);
    case "overdue":
      return null;
  }
}

/**
 * The arc a quick-added action inherits: the active Arc filter, but only when
 * it belongs to the chosen focus — the API enforces same-focus arcs (D17),
 * and an arc from another focus would leave the capture invisible under the
 * filter that spawned it.
 */
export function inheritArcId(
  filterArc: string | undefined,
  focusId: string,
  arcs: readonly { id: string; focusId: string }[],
): string | null {
  return filterArc && arcs.some((a) => a.id === filterArc && a.focusId === focusId)
    ? filterArc
    : null;
}

const FOCUS_KEY = "progress:agenda-quickadd-focus";

export function loadQuickAddFocus(): string | null {
  try {
    return window.localStorage.getItem(FOCUS_KEY);
  } catch {
    return null;
  }
}

export function saveQuickAddFocus(focusId: string): void {
  try {
    window.localStorage.setItem(FOCUS_KEY, focusId);
  } catch {
    /* sticky preference is a nicety — ignore storage failures */
  }
}
