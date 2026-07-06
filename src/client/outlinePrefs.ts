// Sticky Outline preferences (PROG-77). The Outline view shows completed
// (done/canceled) issues by default — dimmed and struck through — but a
// page-level toggle can hide them entirely. That choice is a per-user view
// preference, so we persist it to localStorage: it survives navigating away from
// /outline and coming back, instead of resetting every visit. Single-user app,
// so one global key suffices (mirrors boardFilters.ts).

const HIDE_DONE_KEY = "progress:outline-hide-done";

// localStorage can throw (private mode, storage disabled, quota). The toggle is
// a convenience, never load-bearing, so every access fails soft: a throw just
// means "default this time" rather than a broken view.
export function loadHideDone(): boolean {
  try {
    return window.localStorage.getItem(HIDE_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveHideDone(hide: boolean): void {
  try {
    if (hide) window.localStorage.setItem(HIDE_DONE_KEY, "1");
    else window.localStorage.removeItem(HIDE_DONE_KEY);
  } catch {
    /* sticky preference is a nicety — ignore storage failures */
  }
}

// The Outline's scope picker is sticky the same way (PROG-87 follow-up): leave
// /outline and come back and it reopens on the scope you were in. The URL
// params still win when present (links stay shareable); this only fills the
// bare /outline case. The id is validated against live data on load, so a
// deleted/archived scope just falls through to the default.

const SCOPE_KEY = "progress:outline-scope";

export type OutlineScope = { kind: "product" | "initiative"; id: string };

export function loadScope(): OutlineScope | null {
  try {
    const raw = window.localStorage.getItem(SCOPE_KEY);
    if (!raw) return null;
    const sep = raw.indexOf(":");
    const kind = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if ((kind === "product" || kind === "initiative") && id) return { kind, id };
  } catch {
    /* default this time */
  }
  return null;
}

export function saveScope(scope: OutlineScope): void {
  try {
    window.localStorage.setItem(SCOPE_KEY, `${scope.kind}:${scope.id}`);
  } catch {
    /* sticky preference is a nicety — ignore storage failures */
  }
}
