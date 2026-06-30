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
