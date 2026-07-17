// The consistent action list (PROG-126): every container page renders its
// actions through this one component, switchable between two modes —
//
// - **Outline**: the real outline view (OutlineView, PROG-124/86/87/118),
//   scoped to the page's container — nested steps, capture rows, drag to
//   reorder/move, exactly as on /outline.
// - **Table**: the search page's sortable table (ActionTable, PROG-78) with a
//   quick-search box filtering the scoped list. With no column sort active the
//   rows follow the shared fractional `rank` — the same manual order the
//   outline and board show — so the two modes agree on "the order".
//
// The mode is a sticky per-surface preference (viewPrefs); "Hide done" is the
// outline page's sticky toggle (PROG-77), shared here so done/canceled rows
// can be hidden from either mode.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { WireAction, SnapshotPayload } from "../shared/types";
import { isOpenStatus } from "../shared/constants";
import ActionTable from "./ActionTable";
import { OutlineView, type OutlineViewScope } from "./pages/Outline";
import { byRankThenNumber } from "./outlineTree";
import { loadHideDone, saveHideDone } from "./outlinePrefs";
import { loadViewMode, saveViewMode, type ActionViewMode } from "./viewPrefs";
import {
  actionMatches,
  cycleActionSort,
  queryTerms,
  sortActionHits,
  type ActionSort,
  type ActionSortKey,
} from "./search";

// The segmented Outline/Table switch — also used by the Agenda, whose list
// mode isn't an outline, hence the configurable first label.
export function ViewModeToggle({
  mode,
  onChange,
  outlineLabel = "Outline",
}: {
  mode: ActionViewMode;
  onChange: (mode: ActionViewMode) => void;
  outlineLabel?: string;
}) {
  const btn = (value: ActionViewMode, label: string) => (
    <button
      onClick={() => onChange(value)}
      aria-pressed={mode === value}
      className={`px-2 py-1 text-xs ${
        mode === value ? "bg-line text-ink" : "bg-card text-ink-faint hover:text-ink-soft"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex overflow-hidden rounded border border-line">
      {btn("outline", outlineLabel)}
      {btn("table", "Table")}
    </div>
  );
}

export default function ActionListView({
  snapshot,
  scope,
  actions,
  surface,
  toolbarExtras,
}: {
  snapshot: SnapshotPayload;
  // Drives the outline mode's rendering; also names the surface's actions.
  scope: OutlineViewScope;
  // The scoped action list (the page already derives it — workspace pages
  // aggregate across focuses, focus/arc pages filter by container).
  actions: WireAction[];
  // Sticky view-mode namespace, e.g. "container".
  surface: string;
  // Page-specific links that ride in the toolbar row ("Open on board →" &c.).
  toolbarExtras?: ReactNode;
}) {
  const [mode, setMode] = useState<ActionViewMode>(() => loadViewMode(surface, "outline"));
  const setModeSticky = (next: ActionViewMode) => {
    setMode(next);
    saveViewMode(surface, next);
  };

  // Hide done/canceled — the outline page's sticky preference (PROG-77),
  // applied in both modes.
  const [hideDone, setHideDone] = useState(loadHideDone);
  const toggleHideDone = (next: boolean) => {
    setHideDone(next);
    saveHideDone(next);
  };

  const visible = useMemo(
    () => (hideDone ? actions.filter((a) => isOpenStatus(a.status)) : actions),
    [actions, hideDone],
  );

  // Table mode: quick search over the scoped list (same matching rule as the
  // search page), then column sort — or, with no sort active, the shared
  // fractional `rank` (the outline/board manual order, PROG-43/86).
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<ActionSort | null>(null);
  const terms = useMemo(() => queryTerms(q), [q]);
  const tableRows = useMemo(() => {
    const base = visible
      .filter((a) => actionMatches(terms, a))
      .sort(byRankThenNumber)
      .map((action) => ({ action, score: 0, inTitle: true }));
    return sortActionHits(snapshot, base, sort);
  }, [snapshot, visible, terms, sort]);

  // On a focus or arc page every row shares the container, so the Focus
  // column is dropped; workspace pages span focuses and keep it.
  const columns: readonly ActionSortKey[] =
    scope.kind === "workspace"
      ? ["key", "title", "focus", "status", "priority", "updated"]
      : ["key", "title", "status", "priority", "updated"];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <h2 className="mr-auto text-sm font-medium uppercase tracking-wide font-mono text-ink-faint">
          Actions · {visible.length}
        </h2>
        {toolbarExtras}
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={hideDone}
            onChange={(e) => toggleHideDone(e.target.checked)}
            className="h-3.5 w-3.5 accent-adobe-deep"
          />
          Hide done
        </label>
        <ViewModeToggle mode={mode} onChange={setModeSticky} />
      </div>

      {mode === "outline" ? (
        <div className="mt-3">
          <OutlineView snapshot={snapshot} scope={scope} hideDone={hideDone} />
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Quick search…"
            aria-label="Quick search this list"
            className="w-full rounded border border-line bg-card px-3 py-1.5 text-sm focus:border-ink-faint focus:outline-none"
          />
          {tableRows.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-3 text-xs text-ink-faint">
              {visible.length === 0 ? "No actions here." : "No actions match."}
            </p>
          ) : (
            <ActionTable
              snapshot={snapshot}
              rows={tableRows}
              sort={sort}
              onCycleSort={(key) => setSort((s) => cycleActionSort(s, key))}
              columns={columns}
              terms={terms}
            />
          )}
        </div>
      )}
    </div>
  );
}
