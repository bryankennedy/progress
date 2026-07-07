// Sticky filters (PROG-58, generalized to search in PROG-92). A filtered
// surface's state lives entirely in its URL query string (see Home.tsx /
// Search.tsx via FilterBar's useStickyFilterUrl). We mirror it to localStorage
// so returning through the header nav — a bare "/" or "/search" — restores the
// last selection instead of resetting to "all". The URL stays the single source
// of truth (so a filtered view is still bookmarkable); storage is just a memory
// that re-seeds the URL on a fresh, unfiltered open.

// One storage slot per filtered surface (PROG-92): the board and the search
// page each remember their own last selection.
export const BOARD_FILTERS_KEY = "progress:board-filters";
export const SEARCH_FILTERS_KEY = "progress:search-filters";

// Filter sentinel for "this nullable field is empty" (PROG-76): pick the option
// to find actions with no Arc / Repo / Tag. A reserved value in the URL (e.g.
// `?arc=none`) that can't collide with a real container id — those are always
// prefixed (`arc_…`, `repo_…`, `tag_…`). Priority's own "none" value is a
// different URL key, matched by plain equality and never routed through here, so
// the two never conflict. Stays as-is through `URLSearchParams` (no %-encoding).
export const FILTER_NONE = "none";

// Apply a nullable-id filter (Arc / Repo): the sentinel keeps only actions with
// no value there; any other value is a plain id equality (PROG-76).
export function matchesNullableId(field: string | null, filter: string): boolean {
  return filter === FILTER_NONE ? field === null : field === filter;
}

// localStorage can throw (private mode, storage disabled, quota). Sticky filters
// are a convenience, never load-bearing, so every access fails soft: a throw
// just means "not sticky this time" rather than a broken view.
export function loadStickyFilters(storageKey: string): string {
  try {
    return window.localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

export function saveStickyFilters(storageKey: string, search: string): void {
  try {
    window.localStorage.setItem(storageKey, search);
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

// Parent lookups for cascading filter validity (PROG-75): each maps a container
// id to its parent's id, so a chosen descendant can be checked against the
// chosen ancestors.
export type FilterParents = {
  focusWorkspace: Map<string, string>; // focus id -> workspace id
  arcFocus: Map<string, string>; // arc id -> focus id
  repoFocus: Map<string, string>; // repo id -> focus id
};

// Drop any descendant filter the ancestor selection makes impossible (PROG-75),
// mutating `params` in place. The board's filters are a hierarchy
// (Workspace → Focus → Arc/Repo); changing a parent can strand a child from a
// different branch — e.g. picking a new Focus while an Arc from the old one is
// still selected, which would silently filter the board to nothing. Pruning in
// the same URL write keeps the offered options and the active selection in sync.
export function pruneImpossibleFilters(params: URLSearchParams, parents: FilterParents): void {
  const workspace = params.get("workspace");
  let focus = params.get("focus");
  if (focus && workspace && parents.focusWorkspace.get(focus) !== workspace) {
    params.delete("focus");
    focus = null;
  }
  for (const [key, parentOf] of [
    ["arc", parents.arcFocus],
    ["repo", parents.repoFocus],
  ] as const) {
    const id = params.get(key);
    // "No arc/repo" (PROG-76) belongs to no branch, so it's compatible with any
    // ancestor selection — never prune it.
    if (!id || id === FILTER_NONE) continue;
    const owningFocus = parentOf.get(id);
    // With a Focus chosen, the child must belong to it; otherwise (Workspace
    // only) the child's Focus must belong to that Workspace.
    const impossible = focus
      ? owningFocus !== focus
      : !!workspace && parents.focusWorkspace.get(owningFocus ?? "") !== workspace;
    if (impossible) params.delete(key);
  }
}

// Order name-based filter dropdown options alphabetically (PROG-66) so a long
// Arc / Focus / Repo / Workspace / tag list is scannable. Returns a new array
// (the input may be a live store array, e.g. snapshot.tags). Logical
// vocabularies — status, priority — keep their meaningful order and must NOT use
// this; their fixed sequence is the order they read in.
export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}
