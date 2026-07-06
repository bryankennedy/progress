// Quick-add support for the Agenda view (PROG-89): each date grouping (except
// Overdue) carries an input that creates an issue pre-dated for that bucket.
// The date math is pure and lives here so it can be unit-tested; the sticky
// "which product did I last quick-add into" preference follows the
// outlinePrefs/boardFilters localStorage pattern (fail-soft, never
// load-bearing).

import { addDays, type AgendaBucket } from "./dates";

/**
 * The due date a quick-added issue gets for a bucket, relative to local
 * `today`. Buckets are rolling windows (D38), so the defaults are the window's
 * edges: Today → today; This week → today+6 (the last day of the rolling
 * window, "by end of week"); Later → today+7 (the first day beyond it). Each
 * lands the new issue in the bucket it was typed under. Overdue has no input —
 * an issue can't be born already late — so it maps to null.
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

const PRODUCT_KEY = "progress:agenda-quickadd-product";

export function loadQuickAddProduct(): string | null {
  try {
    return window.localStorage.getItem(PRODUCT_KEY);
  } catch {
    return null;
  }
}

export function saveQuickAddProduct(productId: string): void {
  try {
    window.localStorage.setItem(PRODUCT_KEY, productId);
  } catch {
    /* sticky preference is a nicety — ignore storage failures */
  }
}
