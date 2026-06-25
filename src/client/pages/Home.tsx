// The global "My Work" board (SPEC §4): one kanban across all initiatives
// and products. Columns are the fixed statuses minus Canceled (PROG-63 — the
// board shows work you intend to do); Backlog hides behind a toggle by default
// (open question #2 default). Filters live in URL query
// params so any filtered board is bookmarkable — this is how the global
// board covers the deferred per-product/per-arc boards.
//
// Cards carry a manual vertical order within their column (PROG-43): drag a
// card above or below another to set the order you'll work them in. Position is
// a fractional-index `rank` (src/shared/rank.ts), so a drop is a single
// optimistic write — no renumbering. Dragging across columns sets status *and*
// position in one move.

import {
  closestCenter,
  DndContext,
  DragOverlay,
  getFirstCollision,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssuePriority,
  type IssueStatus,
} from "../../shared/constants";
import { rankBetween } from "../../shared/rank";
import { reorder, type ColumnMap } from "../boardOrder";
import { filtersToRestore, loadBoardFilters, saveBoardFilters, sortByName } from "../boardFilters";
import { recentlyCompleted } from "../boardDone";
import type { WireIssue, WireTag, WorkspacePayload } from "../../shared/types";
import { openCreateIssue } from "../commands/controller";
import { dayDiff, formatDueDate, relativeDue, todayISO } from "../dates";
import { PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import PriorityIndicator from "../PriorityIndicator";
import { issueKeyOf, loadStats, updateIssue, type IssuePatch } from "../store";

const FILTER_KEYS = ["initiative", "product", "repo", "arc", "tag", "priority"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Partial<Record<FilterKey, string>> & { backlog?: boolean };

// Binary (byte-order) comparison — ranks span digits + letters whose ASCII
// order is the alphabet order, so `localeCompare` (case-folding, locale-aware)
// would mis-sort them. Matches SQLite's default BINARY collation.
const byRank = (a: WireIssue, b: WireIssue) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);

function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const filters: Filters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  filters.backlog = params.get("backlog") === "1";
  return filters;
}

export default function Home({ workspace }: { workspace: WorkspacePayload }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const filters = useMemo(() => parseFilters(search), [search]);

  // Sticky filters (PROG-58): on a fresh mount with a bare URL, re-apply the
  // saved selection; thereafter mirror the URL into storage on every change.
  // Captured once at mount so a later filter change doesn't re-trigger a
  // restore. A no-op when there's nothing saved or the URL already has filters.
  const [restoreTarget] = useState(() => filtersToRestore(search, loadBoardFilters()));
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!restoredRef.current && restoreTarget) {
      restoredRef.current = true;
      navigate(`/?${restoreTarget}`, { replace: true });
      return; // don't persist the transient pre-restore (empty) URL
    }
    saveBoardFilters(search);
  }, [search, navigate, restoreTarget]);

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(search);
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    navigate(qs ? `/?${qs}` : "/", { replace: true });
  };

  const tagsByIssue = useMemo(() => {
    const tagById = new Map(workspace.tags.map((t) => [t.id, t]));
    const map = new Map<string, WireTag[]>();
    for (const link of workspace.issueTags) {
      const tag = tagById.get(link.tagId);
      if (!tag) continue;
      const list = map.get(link.issueId) ?? [];
      list.push(tag);
      map.set(link.issueId, list);
    }
    return map;
  }, [workspace.tags, workspace.issueTags]);

  const issuesById = useMemo(
    () => new Map(workspace.issues.map((i) => [i.id, i])),
    [workspace.issues],
  );

  const visibleByStatus = useMemo(() => {
    const productIdsInInitiative = filters.initiative
      ? new Set(
          workspace.products
            .filter((p) => p.initiativeId === filters.initiative)
            .map((p) => p.id),
        )
      : null;
    const issues = workspace.issues.filter((issue) => {
      if (productIdsInInitiative && !productIdsInInitiative.has(issue.productId)) return false;
      if (filters.product && issue.productId !== filters.product) return false;
      if (filters.repo && issue.repoId !== filters.repo) return false;
      if (filters.arc && issue.arcId !== filters.arc) return false;
      if (filters.priority && issue.priority !== filters.priority) return false;
      if (filters.tag && !(tagsByIssue.get(issue.id) ?? []).some((t) => t.id === filters.tag))
        return false;
      return true;
    });
    const groups = new Map<IssueStatus, WireIssue[]>(ISSUE_STATUSES.map((s) => [s, []]));
    for (const issue of issues) groups.get(issue.status)!.push(issue);
    // Manual board order (PROG-43): cards sort by their fractional rank.
    for (const group of groups.values()) group.sort(byRank);
    // Done can grow without bound — cap it to the most recently completed
    // issues so it doesn't dominate the board (PROG-40). `doneTotal` keeps the
    // header honest about how many are hidden.
    const doneTotal = groups.get("done")!.length;
    groups.set("done", recentlyCompleted(groups.get("done")!));
    return { groups, doneTotal };
  }, [workspace.issues, workspace.products, filters, tagsByIssue]);

  // The drag model works on ordered id-lists per column. `sourceColumns` is the
  // store's truth (rank order); `columns` is a working copy mutated live during
  // a drag for cross-column preview and reset from source when idle.
  const sourceColumns = useMemo(() => {
    const cols = {} as ColumnMap;
    for (const status of ISSUE_STATUSES)
      cols[status] = visibleByStatus.groups.get(status)!.map((i) => i.id);
    return cols;
  }, [visibleByStatus]);

  const [columns, setColumns] = useState<ColumnMap>(sourceColumns);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Mirror of activeId for effects/handlers that must read it without depending
  // on it (a ref updates synchronously and doesn't re-trigger effects).
  const activeIdRef = useRef<string | null>(null);
  const setActive = (id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  };

  // Re-sync the working copy from the store ONLY when the store itself changes
  // (and not mid-drag). Crucially this does NOT depend on `activeId`: keying it
  // on activeId made the resync fire the instant a drop cleared the drag — one
  // render before the optimistic store write landed — so it briefly reset the
  // just-moved card to its OLD column (a sub-100ms flash) before the store
  // caught up and corrected it (PROG-40 follow-up). Now the resync waits for the
  // fresh `sourceColumns`, so it never applies a stale order.
  useEffect(() => {
    if (!activeIdRef.current) setColumns(sourceColumns);
  }, [sourceColumns]);

  // Mouse: a distance constraint keeps plain clicks (card → issue page) from
  // starting a drag. Touch: a hold-delay keeps swipes scrolling the board
  // horizontally — press-and-hold a card to drag it (SPEC §4 mobile).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const draggingIssue = activeId ? issuesById.get(activeId) : undefined;

  // Collision strategy for variable-height columns (PROG-40/PROG-59). Plain
  // closestCorners measures distance to a droppable's corners, so a tall EMPTY
  // column (its corners far from the pointer) loses to a small card in a
  // neighbouring column — the card then lands in the wrong column or snaps back.
  // Instead: take what the pointer is actually inside; if that's a column,
  // narrow to the closest card within it (or keep the column itself when it's
  // empty, so an empty column accepts the drop). Falls back to the last target
  // so the card doesn't flicker away over a gutter. (The canonical dnd-kit
  // multiple-containers pattern.)
  const lastOverId = useRef<string | null>(null);
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const pointer = pointerWithin(args);
      const hits = pointer.length > 0 ? pointer : rectIntersection(args);
      let overId = getFirstCollision(hits, "id") as string | null;
      if (overId != null) {
        if (overId in columns) {
          const items = columns[overId as IssueStatus];
          if (items.length > 0) {
            const inner = closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter(
                (c) => c.id !== overId && items.includes(String(c.id)),
              ),
            });
            overId = (getFirstCollision(inner, "id") as string | null) ?? overId;
          }
        }
        lastOverId.current = overId;
        return [{ id: overId }];
      }
      return lastOverId.current ? [{ id: lastOverId.current }] : [];
    },
    [columns],
  );

  const columnOf = (id: string): IssueStatus | undefined => {
    if (id in columns) return id as IssueStatus; // dropped on a column itself
    return ISSUE_STATUSES.find((s) => columns[s].includes(id));
  };

  const onDragStart = (e: DragStartEvent) => setActive(String(e.active.id));

  // Live preview only: float the active card into the column it's hovering.
  // Final placement is recomputed from scratch in onDragEnd, so this never
  // affects correctness — only what you see while dragging.
  const onDragOver = (e: DragOverEvent) => {
    const id = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    const from = columnOf(id);
    const to = columnOf(overId);
    if (!from || !to || from === to) return;
    setColumns((prev) => {
      const toItems = prev[to];
      const overIsColumn = overId in prev;
      const translated = e.active.rect.current.translated;
      const below =
        !overIsColumn && translated && e.over
          ? translated.top > e.over.rect.top + e.over.rect.height / 2
          : false;
      const overIndex = overIsColumn ? toItems.length : toItems.indexOf(overId);
      const insertAt = overIsColumn ? toItems.length : overIndex + (below ? 1 : 0);
      return {
        ...prev,
        [from]: prev[from].filter((x) => x !== id),
        [to]: [...toItems.slice(0, insertAt), id, ...toItems.slice(insertAt)],
      };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const id = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    const issue = issuesById.get(id);
    if (!overId || !issue) {
      setColumns(sourceColumns);
      return;
    }
    // Resolve placement from the LIVE `columns`, which onDragOver has already
    // updated to the on-screen preview (PROG-59). Using the frozen pre-drag
    // order here is wrong for a cross-column drop into a populated column: the
    // preview has moved the active card into the target, so on release dnd-kit
    // reports `over` as the active card itself — which, looked up in the stale
    // order, still sits in the source column, so the move collapsed to a no-op
    // and the card flew back. `below` = pointer past the hovered card's middle,
    // used only when active and over land in different columns.
    const translated = e.active.rect.current.translated;
    const below =
      translated && e.over ? translated.top > e.over.rect.top + e.over.rect.height / 2 : false;
    const result = reorder(columns, id, overId, below);
    if (!result) {
      setColumns(sourceColumns);
      return;
    }
    const { columns: next, to } = result;
    setColumns(next);

    const targetItems = next[to];
    const pos = targetItems.indexOf(id);
    const prevId = pos > 0 ? targetItems[pos - 1]! : null;
    const nextId = pos < targetItems.length - 1 ? targetItems[pos + 1]! : null;

    // No-op guard: same column and same neighbors as the stored order ⇒ a click
    // or a drag that landed back home; skip the write.
    const src = sourceColumns[issue.status];
    const sIdx = src.indexOf(id);
    const srcPrev = sIdx > 0 ? src[sIdx - 1]! : null;
    const srcNext = sIdx < src.length - 1 ? src[sIdx + 1]! : null;
    if (to === issue.status && srcPrev === prevId && srcNext === nextId) return;

    const newRank = rankBetween(
      prevId ? (issuesById.get(prevId)?.rank ?? null) : null,
      nextId ? (issuesById.get(nextId)?.rank ?? null) : null,
    );
    const patch: IssuePatch = { rank: newRank };
    if (to !== issue.status) patch.status = to;
    updateIssue(id, patch);
  };

  const onDragCancel = () => {
    setActive(null);
    setColumns(sourceColumns);
  };

  // Canceled is a valid status (set it from the issue page or any status
  // dropdown) but never gets a board column — PROG-63: the board is for work
  // you intend to do, so canceled issues just drop off it. Backlog still hides
  // behind its toggle.
  const visibleColumns = ISSUE_STATUSES.filter(
    (s) => s !== "canceled" && (s !== "backlog" || filters.backlog),
  );
  const shownCount = visibleColumns.reduce((n, s) => n + columns[s].length, 0);
  const filtersActive = FILTER_KEYS.some((k) => filters[k]);

  return (
    <>
      {/* No page title here: the global header already shows the "Progress"
          app name (PROG-53 — drop the redundant heading). */}
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-xs text-ink-faint">
          {shownCount} issues on board · {workspace.issues.length} total · loaded in{" "}
          {Math.round(loadStats.fetchMs)} ms · ⌘K for commands
        </p>
        <button
          onClick={() => openCreateIssue()}
          className="ml-auto rounded bg-adobe px-3 py-1 text-sm text-white hover:bg-adobe-deep"
        >
          New issue <span className="text-white/70">(C)</span>
        </button>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        {/* Archived containers stay out of the dropdowns (D26); their issues
            still render, so nothing silently disappears from the board. */}
        <FilterSelect
          label="Initiative"
          value={filters.initiative}
          options={sortByName(workspace.initiatives.filter((i) => !i.archivedAt)).map((i) => [
            i.id,
            i.name,
          ])}
          onChange={(v) => setParam("initiative", v)}
        />
        <FilterSelect
          label="Product"
          value={filters.product}
          options={sortByName(
            workspace.products
              .filter((p) => !p.archivedAt)
              .filter((p) => !filters.initiative || p.initiativeId === filters.initiative),
          ).map((p) => [p.id, p.name])}
          onChange={(v) => setParam("product", v)}
        />
        <FilterSelect
          label="Repo"
          value={filters.repo}
          options={sortByName(
            workspace.repos
              .filter((r) => !r.archivedAt)
              .filter((r) => !filters.product || r.productId === filters.product),
          ).map((r) => [r.id, r.name])}
          onChange={(v) => setParam("repo", v)}
        />
        <FilterSelect
          label="Arc"
          value={filters.arc}
          options={sortByName(
            workspace.arcs
              .filter((a) => !a.archivedAt)
              .filter((a) => !filters.product || a.productId === filters.product),
          ).map((a) => [a.id, a.name])}
          onChange={(v) => setParam("arc", v)}
        />
        <FilterSelect
          label="Tag"
          value={filters.tag}
          options={sortByName(workspace.tags).map((t) => [t.id, t.name])}
          onChange={(v) => setParam("tag", v)}
        />
        <FilterSelect
          label="Priority"
          value={filters.priority}
          options={ISSUE_PRIORITIES.map((p) => [p, PRIORITY_LABELS[p]])}
          onChange={(v) => setParam("priority", v)}
        />
        <button
          onClick={() => setParam("backlog", filters.backlog ? null : "1")}
          className={`rounded border px-2 py-1 text-xs ${
            filters.backlog
              ? "border-ink-faint bg-line text-ink-soft"
              : "border-line bg-card text-ink-faint hover:border-ink-faint"
          }`}
        >
          {filters.backlog ? "Hide backlog" : "Show backlog"}
        </button>
        {filtersActive && (
          <button
            onClick={() => navigate(filters.backlog ? "/?backlog=1" : "/", { replace: true })}
            className="text-xs text-ink-faint underline hover:text-ink-soft"
          >
            Clear filters
          </button>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {/* items-stretch: all columns share the tallest column's height, so a
            card can be dragged straight sideways into any column's drop zone
            instead of having to travel to its top (PROG-40). */}
        <div className="mt-5 flex items-stretch gap-3 overflow-x-auto pb-6">
          {visibleColumns.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              issueIds={columns[status]}
              total={status === "done" ? visibleByStatus.doneTotal : undefined}
              issuesById={issuesById}
              workspace={workspace}
              tagsByIssue={tagsByIssue}
              activeId={activeId}
            />
          ))}
        </div>
        {/* dropAnimation={null}: skip the default drop tween. It animates the
            overlay back to the *original* dragged node, but the reorder is
            already committed to state by onDragEnd, so the tween flies the card
            to its old slot before the re-render snaps it to the new one
            (PROG-43). Dropping it makes the card settle in place instantly —
            on-brand with the instant-UI rule. */}
        <DragOverlay dropAnimation={null}>
          {draggingIssue && (
            <div data-drag-overlay>
              <CardView
                issue={draggingIssue}
                workspace={workspace}
                tags={tagsByIssue.get(draggingIssue.id) ?? []}
                dragging
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: [string, string][];
  onChange: (value: string | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={`rounded border px-2 py-1 text-xs ${
        value ? "border-ink-faint bg-line text-ink-soft" : "border-line bg-card text-ink-soft"
      }`}
    >
      <option value="">{label}: all</option>
      {options.map(([v, name]) => (
        <option key={v} value={v}>
          {name}
        </option>
      ))}
    </select>
  );
}

function BoardColumn({
  status,
  issueIds,
  total,
  issuesById,
  workspace,
  tagsByIssue,
  activeId,
}: {
  status: IssueStatus;
  issueIds: string[];
  // When the column is capped (Done — PROG-40), the true count before capping,
  // so the header can show "shown of total". Undefined ⇒ nothing is hidden.
  total?: number;
  issuesById: Map<string, WireIssue>;
  workspace: WorkspacePayload;
  tagsByIssue: Map<string, WireTag[]>;
  activeId: string | null;
}) {
  // Droppable so an empty column (or the space below the last card) still
  // accepts a drop; cards themselves are the sortable items inside. The
  // section stretches to the board's full height (items-stretch on the row)
  // and the card list grows to fill it, so the drop zone spans the whole
  // column — drag sideways into it without going to the top (PROG-40).
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const hiddenCount = total !== undefined && total > issueIds.length;
  return (
    <section
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-lg p-2 ${isOver ? "bg-adobe-wash/30 ring-1 ring-adobe-light" : "bg-line/40"}`}
    >
      <h2 className="px-1 pb-2 text-xs font-medium uppercase tracking-wide font-mono text-ink-faint">
        {STATUS_LABELS[status]} · {hiddenCount ? `${issueIds.length} of ${total}` : issueIds.length}
      </h2>
      <SortableContext items={issueIds} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-8 flex-1 flex-col gap-1.5">
          {issueIds.map((id) => {
            const issue = issuesById.get(id);
            if (!issue) return null;
            return (
              <BoardCard
                key={id}
                issue={issue}
                workspace={workspace}
                tags={tagsByIssue.get(id) ?? []}
                hidden={activeId === id}
              />
            );
          })}
        </div>
      </SortableContext>
    </section>
  );
}

function BoardCard({
  issue,
  workspace,
  tags,
  hidden,
}: {
  issue: WireIssue;
  workspace: WorkspacePayload;
  tags: WireTag[];
  hidden: boolean;
}) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-issue-id={issue.id}
      className={hidden || isDragging ? "opacity-30" : ""}
      // Keeps taps/holds responsive on touch without blocking board scroll
      // (safe with the hold-delay sensor; touch-action:none would kill
      // scrolling over cards).
      style={{ touchAction: "manipulation", transform: CSS.Transform.toString(transform), transition }}
    >
      <Link href={`/issue/${issueKeyOf(workspace, issue)}`}>
        <CardView issue={issue} workspace={workspace} tags={tags} />
      </Link>
    </div>
  );
}

function CardView({
  issue,
  workspace,
  tags,
  dragging = false,
}: {
  issue: WireIssue;
  workspace: WorkspacePayload;
  tags: WireTag[];
  dragging?: boolean;
}) {
  const product = workspace.products.find((p) => p.id === issue.productId);
  return (
    <div
      className={`cursor-pointer rounded-md border border-line bg-card p-2.5 text-sm hover:border-line ${
        dragging ? "rotate-1 shadow-lg" : "shadow-sm"
      }`}
    >
      <p className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-ink-faint">
          {product?.keyPrefix ?? "?"}-{issue.number}
        </span>
        <span className="text-xs text-ink-faint">{product?.name}</span>
      </p>
      <p className="mt-1 font-medium leading-snug">{issue.title}</p>
      {/* Estimate + tags get their own line so they don't crowd the date/priority
          footer below (PROG-61). */}
      {(issue.estimate !== null || tags.length > 0) && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
          {issue.estimate !== null && (
            <span className="rounded bg-line px-1">{issue.estimate}</span>
          )}
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="rounded-full px-1.5 py-px text-[10px] text-white"
              style={{ backgroundColor: tag.color }}
            >
              {tag.name}
            </span>
          ))}
        </p>
      )}
      {(issue.dueDate || issue.priority !== "none") && (
        // Footer balances the two at-a-glance signals: the due date reads from
        // the bottom-left corner and the priority glyph is pinned bottom-right
        // (PROG-61) so date and priority never crowd each other.
        <div className="mt-2 flex items-end justify-between gap-2 text-xs text-ink-faint">
          <span className="min-w-0">{issue.dueDate && <CardDueDate due={issue.dueDate} />}</span>
          {issue.priority !== "none" && (
            <PriorityIndicator priority={issue.priority} className="shrink-0" />
          )}
        </div>
      )}
    </div>
  );
}

// The due date as it appears on a board card: a calendar glyph + the Agenda's
// own phrasing ("in 3 days · Jul 1"), sized and weighted to match the priority
// indicator so the two corners read as a balanced pair. Color echoes the
// priority language — overdue uses the same on-system danger tomato as urgent,
// due-today the active "adobe" accent, else a quiet neutral.
function CardDueDate({ due }: { due: string }) {
  const today = todayISO();
  const diff = dayDiff(today, due);
  const tone =
    diff < 0 ? "text-danger" : diff === 0 ? "text-adobe-deep font-medium" : "text-ink-soft";
  return (
    <span className={`inline-flex items-center gap-1 font-mono ${tone}`} title={`Due ${due}`}>
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      >
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
        <path d="M2.5 6.5h11M5.5 2v2M10.5 2v2" strokeLinecap="round" />
      </svg>
      {relativeDue(due, today)} · {formatDueDate(due)}
    </span>
  );
}
