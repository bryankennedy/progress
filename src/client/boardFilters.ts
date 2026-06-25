// Sticky board filters (PROG-58). The board's filter state lives entirely in the
// URL query string (see Home.tsx). We mirror it to localStorage so returning to
// the board — e.g. via the header nav, which links to a bare "/" — restores the
// last selection instead of resetting to "all". The URL stays the single source
// of truth (so a filtered board is still bookmarkable); storage is just a memory
// that re-seeds the URL on a fresh, unfiltered open.

const STORAGE_KEY = "progress:board-filters";

// localStorage can throw (private mode, storage disabled, quota). Sticky filters
// are a convenience, never load-bearing, so every access fails soft: a throw
// just means "not sticky this time" rather than a broken board.
export function loadBoardFilters(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveBoardFilters(search: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, search);
  } catch {
    /* sticky filters are a nicety — ignore storage failures */
  }
}

// Decide what to restore when the board mounts: the saved query string, or null
// to leave the URL untouched. Restore only when the board was opened with no
// filters in the URL (a bare "/") and a non-empty selection was saved. A URL
// that already carries filters — a bookmark, or the deep link from a container
// page — always wins and is left as-is (and then mirrored back to storage).
export function filtersToRestore(currentSearch: string, saved: string): string | null {
  return !currentSearch && saved ? saved : null;
}

// Order name-based filter dropdown options alphabetically (PROG-66) so a long
// Arc / Product / Repo / Initiative / tag list is scannable. Returns a new array
// (the input may be a live store array, e.g. workspace.tags). Logical
// vocabularies — status, priority — keep their meaningful order and must NOT use
// this; their fixed sequence is the order they read in.
export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}
