// The shared filter bar (PROG-92): the board and the search page used to carry
// near-identical copies of the six container/priority dropdowns, the hierarchy
// narrowing (PROG-75), the mobile "Filters" disclosure (PROG-81), and the
// "Clear filters" link. Both surfaces now render this one component, and drive
// their URL through one hook — so the two can't drift, the same reasoning as
// the shared FilterSelect (PROG-76) and nav list (PROG-79).
//
// Surface-specific pieces stay with the surface, passed in as slots: the
// search page's Status dropdown renders `before` the shared six, the board's
// backlog/steps toggles render `after`, and each caller owns its own
// "what survives a clear" rule via `onClear`.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { ACTION_PRIORITIES } from "../shared/constants";
import type { SnapshotPayload } from "../shared/types";
import {
  filtersToRestore,
  loadStickyFilters,
  pruneImpossibleFilters,
  saveStickyFilters,
  sortByName,
} from "./boardFilters";
import FilterSelect from "./FilterSelect";
import { PRIORITY_LABELS } from "./labels";

// The dimensions every filtered surface shares. Status is deliberately not
// here: the board has no status filter (its columns are the statuses), so the
// search page passes its Status dropdown through the `before` slot.
export const SHARED_FILTER_KEYS = ["workspace", "focus", "arc", "tag", "priority"] as const;
export type SharedFilterKey = (typeof SHARED_FILTER_KEYS)[number];
export type SharedFilters = Partial<Record<SharedFilterKey, string>>;

// URL plumbing for a filtered surface: setParam writes one key (pruning
// impossible descendants in the same write, PROG-75), and the sticky pattern
// (PROG-58) restores the saved selection on a bare open then mirrors every
// change back to storage. `volatileKeys` (e.g. search's `q`) are stripped
// before saving — they're content, not a selection, so they never stick.
export function useStickyFilterUrl({
  snapshot,
  basePath,
  storageKey,
  volatileKeys = [],
}: {
  snapshot: SnapshotPayload;
  basePath: string;
  storageKey: string;
  volatileKeys?: readonly string[];
}) {
  const search = useSearch();
  const [, navigate] = useLocation();

  // Parent lookups for cascading filter validity (PROG-75).
  const parents = useMemo(
    () => ({
      focusWorkspace: new Map(snapshot.focuses.map((p) => [p.id, p.workspaceId])),
      arcFocus: new Map(snapshot.arcs.map((a) => [a.id, a.focusId])),
    }),
    [snapshot.focuses, snapshot.arcs],
  );

  // Sticky restore (PROG-58): on a fresh mount with a bare URL, re-apply the
  // saved selection; thereafter mirror the URL into storage on every change.
  // Captured once at mount so a later filter change doesn't re-trigger a
  // restore. A URL that already carries params — a bookmark, a deep link, the
  // modal's ?q= handoff — always wins and is then mirrored back to storage.
  const [restoreTarget] = useState(() => filtersToRestore(search, loadStickyFilters(storageKey)));
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!restoredRef.current && restoreTarget) {
      restoredRef.current = true;
      navigate(`${basePath}?${restoreTarget}`, { replace: true });
      return; // don't persist the transient pre-restore (empty) URL
    }
    const params = new URLSearchParams(search);
    for (const key of volatileKeys) params.delete(key);
    saveStickyFilters(storageKey, params.toString());
    // volatileKeys must be a module-level constant (stable reference) so this
    // effect keys off real changes only.
  }, [search, navigate, restoreTarget, storageKey, basePath, volatileKeys]);

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(search);
    if (value) params.set(key, value);
    else params.delete(key);
    // Changing an ancestor can strand a descendant filter from another branch;
    // drop the impossible ones in the same URL write so the view never filters
    // to nothing behind a stale selection (PROG-75).
    pruneImpossibleFilters(params, parents);
    const qs = params.toString();
    navigate(qs ? `${basePath}?${qs}` : basePath, { replace: true });
  };

  return { search, navigate, setParam };
}

export default function FilterBar({
  snapshot,
  filters,
  setParam,
  activeCount,
  clearVisible,
  onClear,
  before,
  after,
}: {
  snapshot: SnapshotPayload;
  filters: SharedFilters;
  setParam: (key: string, value: string | null) => void;
  // How many filters/toggles are narrowing the view — badges the collapsed
  // mobile disclosure. Callers count their surface-specific extras (status,
  // toggles) in too.
  activeCount: number;
  // The Clear link shows only when a clearable *filter* is set — a lit toggle
  // counts toward the badge but isn't cleared, so it doesn't show the link.
  clearVisible: boolean;
  // Clearing is surface-owned: the board keeps its toggles, search keeps q+sort.
  onClear: () => void;
  before?: React.ReactNode;
  after?: React.ReactNode;
}) {
  // Mobile only: the dropdowns collapse behind a "Filters" disclosure so the
  // content sits above the fold instead of a screenful of chrome (PROG-81).
  // Desktop ignores this — the row is always `sm:flex`.
  const [open, setOpen] = useState(false);

  const focusWorkspace = useMemo(
    () => new Map(snapshot.focuses.map((p) => [p.id, p.workspaceId])),
    [snapshot.focuses],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-4 flex min-h-11 w-full items-center gap-2 rounded border border-line bg-card px-3 text-sm text-ink-soft hover:border-ink-faint sm:hidden"
      >
        <span className="font-medium">Filters</span>
        {activeCount > 0 && (
          <span className="rounded-full bg-adobe px-1.5 py-0.5 text-xs font-medium text-white">
            {activeCount}
          </span>
        )}
        <span className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      <div
        className={`${open ? "flex" : "hidden"} mt-3 flex-wrap items-center gap-2 text-sm sm:mt-4 sm:flex`}
      >
        {before}
        {/* Archived containers stay out of the dropdowns (D26); their actions
            still render, so nothing silently disappears from the view. */}
        <FilterSelect
          label="Workspace"
          value={filters.workspace}
          options={sortByName(snapshot.workspaces.filter((i) => !i.archivedAt)).map((i) => [
            i.id,
            i.name,
          ])}
          onChange={(v) => setParam("workspace", v)}
        />
        <FilterSelect
          label="Focus"
          value={filters.focus}
          options={sortByName(
            snapshot.focuses
              .filter((p) => !p.archivedAt)
              .filter((p) => !filters.workspace || p.workspaceId === filters.workspace),
          ).map((p) => [p.id, p.name])}
          onChange={(v) => setParam("focus", v)}
        />
        <FilterSelect
          label="Arc"
          nullable
          value={filters.arc}
          options={sortByName(
            snapshot.arcs
              .filter((a) => !a.archivedAt)
              .filter((a) => !filters.focus || a.focusId === filters.focus)
              .filter(
                (a) => !filters.workspace || focusWorkspace.get(a.focusId) === filters.workspace,
              ),
          ).map((a) => [a.id, a.name])}
          onChange={(v) => setParam("arc", v)}
        />
        <FilterSelect
          label="Tag"
          nullable
          value={filters.tag}
          options={sortByName(snapshot.tags).map((t) => [t.id, t.name])}
          onChange={(v) => setParam("tag", v)}
        />
        <FilterSelect
          label="Priority"
          value={filters.priority}
          options={ACTION_PRIORITIES.map((p) => [p, PRIORITY_LABELS[p]])}
          onChange={(v) => setParam("priority", v)}
        />
        {after}
        {clearVisible && (
          <button
            onClick={onClear}
            className="text-xs text-ink-faint underline hover:text-ink-soft"
          >
            Clear filters
          </button>
        )}
      </div>
    </>
  );
}
