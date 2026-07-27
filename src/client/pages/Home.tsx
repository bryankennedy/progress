// The global "My Work" board (SPEC §4): one kanban across all workspaces
// and focuses. Columns are the fixed statuses minus Canceled (PROG-63 — the
// board shows work you intend to do); Backlog hides behind a toggle by default
// (open question #2 default). Filters live in URL query
// params so any filtered board is bookmarkable — this is how the global
// board covers the deferred per-focus/per-arc boards.
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
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { ACTION_STATUSES, type ActionStatus } from "../../shared/constants";
import { placementRanks } from "../rankPlacement";
import { DROP_ANIMATION } from "../dropAnimation";
import { reorder, type ColumnMap } from "../boardOrder";
import { BOARD_FILTERS_KEY, FILTER_NONE, matchesNullableId } from "../boardFilters";
import FilterBar, { useStickyFilterUrl } from "../FilterBar";
import { recentlyCompleted } from "../boardDone";
import type { WireAction, WireTag, SnapshotPayload } from "../../shared/types";
import { openCreateAction } from "../commands/controller";
import { dayDiff, formatDueDate, relativeDue, todayISO } from "../dates";
import { tagsByAction as buildTagsByAction } from "../tags";
import { STATUS_LABELS } from "../labels";
import PriorityIndicator from "../PriorityIndicator";
import { actionKeyOf, loadStats, updateAction, type ActionPatch } from "../store";

const FILTER_KEYS = ["workspace", "focus", "arc", "tag", "priority"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Partial<Record<FilterKey, string>> & { backlog?: boolean; steps?: boolean };

// Binary (byte-order) comparison — ranks span digits + letters whose ASCII
// order is the alphabet order, so `localeCompare` (case-folding, locale-aware)
// would mis-sort them. Matches SQLite's default BINARY collation.
const byRank = (a: WireAction, b: WireAction) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);

function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const filters: Filters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  filters.backlog = params.get("backlog") === "1";
  // Steps (PROG-124) are hidden by default so the board stays one card per
  // top-level deliverable; the toggle surfaces them with a nested style.
  filters.steps = params.get("steps") === "1";
  return filters;
}

export default function Home({ snapshot }: { snapshot: SnapshotPayload }) {
  // URL plumbing + sticky restore + ancestor pruning, shared with the search
  // page (PROG-92, FilterBar.tsx).
  const { search, navigate, setParam } = useStickyFilterUrl({
    snapshot,
    basePath: "/",
    storageKey: BOARD_FILTERS_KEY,
  });
  const filters = useMemo(() => parseFilters(search), [search]);

  const tagsByAction = useMemo(
    () => buildTagsByAction(snapshot),
    [snapshot.tags, snapshot.actionTags],
  );

  const actionsById = useMemo(
    () => new Map(snapshot.actions.map((i) => [i.id, i])),
    [snapshot.actions],
  );

  const visibleByStatus = useMemo(() => {
    const focusIdsInWorkspace = filters.workspace
      ? new Set(
          snapshot.focuses.filter((p) => p.workspaceId === filters.workspace).map((p) => p.id),
        )
      : null;
    const actions = snapshot.actions.filter((action) => {
      // Child actions stay off the board unless "show steps" is on (PROG-124).
      if (!filters.steps && action.parentActionId !== null) return false;
      if (focusIdsInWorkspace && !focusIdsInWorkspace.has(action.focusId)) return false;
      if (filters.focus && action.focusId !== filters.focus) return false;
      // Nullable arc (PROG-76): the "none" sentinel matches actions with no
      // arc; any other value is plain id equality.
      if (filters.arc && !matchesNullableId(action.arcId, filters.arc)) return false;
      if (filters.priority && action.priority !== filters.priority) return false;
      if (filters.tag) {
        const actionTags = tagsByAction.get(action.id) ?? [];
        const ok =
          filters.tag === FILTER_NONE
            ? actionTags.length === 0
            : actionTags.some((t) => t.id === filters.tag);
        if (!ok) return false;
      }
      return true;
    });
    const groups = new Map<ActionStatus, WireAction[]>(ACTION_STATUSES.map((s) => [s, []]));
    for (const action of actions) groups.get(action.status)!.push(action);
    // Manual board order (PROG-43): cards sort by their fractional rank.
    for (const group of groups.values()) group.sort(byRank);
    // Done can grow without bound — cap it to the most recently completed
    // actions so it doesn't dominate the board (PROG-40). `doneTotal` keeps the
    // header honest about how many are hidden.
    const doneTotal = groups.get("done")!.length;
    groups.set("done", recentlyCompleted(groups.get("done")!));
    return { groups, doneTotal };
  }, [snapshot.actions, snapshot.focuses, filters, tagsByAction]);

  // The drag model works on ordered id-lists per column. `sourceColumns` is the
  // store's truth (rank order); `columns` is a working copy mutated live during
  // a drag for cross-column preview and reset from source when idle.
  const sourceColumns = useMemo(() => {
    const cols = {} as ColumnMap;
    for (const status of ACTION_STATUSES)
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

  // Mouse: a distance constraint keeps plain clicks (card → action page) from
  // starting a drag. Touch: a hold-delay keeps swipes scrolling the board
  // horizontally — press-and-hold a card to drag it (SPEC §4 mobile).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const draggingAction = activeId ? actionsById.get(activeId) : undefined;

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
          const items = columns[overId as ActionStatus];
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

  const columnOf = (id: string): ActionStatus | undefined => {
    if (id in columns) return id as ActionStatus; // dropped on a column itself
    return ACTION_STATUSES.find((s) => columns[s].includes(id));
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

  // Guarded (PROG-129): a drop whose rank math fails must reset to the stored
  // order, never throw out of dnd-kit's drag-end batch — that unmounted the
  // whole page.
  const onDragEnd = (e: DragEndEvent) => {
    try {
      onDragEndInner(e);
    } catch (err) {
      console.error("drop failed", err);
      setColumns(sourceColumns);
    }
  };

  const onDragEndInner = (e: DragEndEvent) => {
    setActive(null);
    const id = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    const action = actionsById.get(id);
    if (!overId || !action) {
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
    const src = sourceColumns[action.status];
    const sIdx = src.indexOf(id);
    const srcPrev = sIdx > 0 ? src[sIdx - 1]! : null;
    const srcNext = sIdx < src.length - 1 ? src[sIdx + 1]! : null;
    if (to === action.status && srcPrev === prevId && srcNext === nextId) return;

    // Place among the column's OTHER cards (PROG-129): placementRanks mints the
    // dropped card's rank, plus heal rewrites when the slot's neighbours carry
    // tied duplicate keys — the case that used to throw and blank the page.
    const others = targetItems.filter((x) => x !== id && actionsById.has(x));
    const placed = placementRanks(
      others.map((x) => actionsById.get(x)!.rank),
      pos > others.length ? others.length : pos,
    );
    for (const h of placed.heal) updateAction(others[h.index]!, { rank: h.rank });
    const patch: ActionPatch = { rank: placed.rank };
    if (to !== action.status) patch.status = to;
    updateAction(id, patch);
  };

  const onDragCancel = () => {
    setActive(null);
    setColumns(sourceColumns);
  };

  // Canceled is a valid status (set it from the action page or any status
  // dropdown) but never gets a board column — PROG-63: the board is for work
  // you intend to do, so canceled actions just drop off it. Backlog still hides
  // behind its toggle.
  const visibleColumns = ACTION_STATUSES.filter(
    (s) => s !== "canceled" && (s !== "backlog" || filters.backlog),
  );
  const shownCount = visibleColumns.reduce((n, s) => n + columns[s].length, 0);
  const filtersActive = FILTER_KEYS.some((k) => filters[k]);
  // Badge on the mobile "Filters" toggle: how many filters/toggles are narrowing
  // the board right now, so a collapsed panel still signals it's doing something.
  const activeFilterCount =
    FILTER_KEYS.filter((k) => filters[k]).length +
    (filters.backlog ? 1 : 0) +
    (filters.steps ? 1 : 0);

  return (
    <>
      {/* No page title here: the global header already shows the "Progress"
          app name (PROG-53 — drop the redundant heading). */}
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-xs text-ink-faint">
          {shownCount} actions on board · {snapshot.actions.length} total · loaded in{" "}
          {Math.round(loadStats.fetchMs)} ms · ⌘K for commands
        </p>
        <button
          onClick={() => openCreateAction()}
          className="ml-auto inline-flex min-h-11 items-center rounded bg-adobe px-3 py-1 text-sm text-white hover:bg-adobe-deep sm:min-h-0"
        >
          New action <span className="ml-1 text-white/70">(C)</span>
        </button>
      </header>

      {/* The shared filter bar (PROG-92): six dropdowns + mobile disclosure +
          Clear, identical to the search page's. The board's toggles ride in the
          `after` slot; clearing keeps them (they're view modes, not filters). */}
      <FilterBar
        snapshot={snapshot}
        filters={filters}
        setParam={setParam}
        activeCount={activeFilterCount}
        clearVisible={filtersActive}
        onClear={() => {
          const params = new URLSearchParams(search);
          for (const key of FILTER_KEYS) params.delete(key);
          const qs = params.toString();
          navigate(qs ? `/?${qs}` : "/", { replace: true });
        }}
        after={
          <>
            <button
              onClick={() => setParam("backlog", filters.backlog ? null : "1")}
              className={`inline-flex min-h-11 items-center rounded border px-3 py-1 text-xs sm:min-h-0 sm:px-2 ${
                filters.backlog
                  ? "border-ink-faint bg-line text-ink-soft"
                  : "border-line bg-card text-ink-faint hover:border-ink-faint"
              }`}
            >
              {filters.backlog ? "Hide backlog" : "Show backlog"}
            </button>
            <button
              onClick={() => setParam("steps", filters.steps ? null : "1")}
              className={`inline-flex min-h-11 items-center rounded border px-3 py-1 text-xs sm:min-h-0 sm:px-2 ${
                filters.steps
                  ? "border-ink-faint bg-line text-ink-soft"
                  : "border-line bg-card text-ink-faint hover:border-ink-faint"
              }`}
            >
              {filters.steps ? "Hide steps" : "Show steps"}
            </button>
          </>
        }
      />

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        // Tame the edge auto-scroll. dnd-kit's default acceleration (10) scrolls
        // the board ~2000px/s when a dragged card reaches the left/right edge —
        // far too fast to land in the intended column on a phone, where only
        // ~one column is visible (PROG-79 follow-up). acceleration 2 caps it at
        // ~320px/s (≈ one column per second) while keeping the smooth 5ms scroll
        // cadence — deliberate and controllable. It's the single knob to dial
        // (raising `interval` instead would make the motion choppy).
        autoScroll={{ acceleration: 2 }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {/* items-stretch: all columns share the tallest column's height, so a
            card can be dragged straight sideways into any column's drop zone
            instead of having to travel to its top (PROG-40).

            snap-x snap-mandatory (+ snap-start on each column): when the columns
            overflow — i.e. on a phone, where they hit their min-w-72 floor — a
            horizontal swipe always settles with a column pinned to the left
            edge, making each column a "home" for the scroll instead of resting
            mid-column. It's a no-op on desktop, where flex-1 fits every column
            and the row never scrolls. Suppressed while a card is being dragged
            (activeId): the drag edge auto-scroll (PROG-47/48) scrolls this same
            row programmatically, and mandatory snap fights it — re-snapping
            after each step, which stutters the auto-scroll toward the target
            column. On drop, activeId clears and the row re-snaps to the nearest
            column. */}
        <div
          className={`mt-5 flex items-stretch gap-3 overflow-x-auto pb-6 ${
            activeId ? "" : "snap-x snap-mandatory"
          }`}
        >
          {visibleColumns.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              actionIds={columns[status]}
              total={status === "done" ? visibleByStatus.doneTotal : undefined}
              actionsById={actionsById}
              snapshot={snapshot}
              tagsByAction={tagsByAction}
              activeId={activeId}
            />
          ))}
        </div>
        {/* On release the overlay glides into the card's committed slot
            (PROG-118 polish, shared DROP_ANIMATION): onDragEnd sets `columns`
            synchronously, so the tween measures the card at its NEW position —
            the old fly-back that dropAnimation={null} worked around (PROG-43)
            can't happen. */}
        <DragOverlay dropAnimation={DROP_ANIMATION}>
          {draggingAction && (
            <div data-drag-overlay>
              <CardView
                action={draggingAction}
                snapshot={snapshot}
                tags={tagsByAction.get(draggingAction.id) ?? []}
                dragging
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function BoardColumn({
  status,
  actionIds,
  total,
  actionsById,
  snapshot,
  tagsByAction,
  activeId,
}: {
  status: ActionStatus;
  actionIds: string[];
  // When the column is capped (Done — PROG-40), the true count before capping,
  // so the header can show "shown of total". Undefined ⇒ nothing is hidden.
  total?: number;
  actionsById: Map<string, WireAction>;
  snapshot: SnapshotPayload;
  tagsByAction: Map<string, WireTag[]>;
  activeId: string | null;
}) {
  // Droppable so an empty column (or the space below the last card) still
  // accepts a drop; cards themselves are the sortable items inside. The
  // section stretches to the board's full height (items-stretch on the row)
  // and the card list grows to fill it, so the drop zone spans the whole
  // column — drag sideways into it without going to the top (PROG-40).
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const hiddenCount = total !== undefined && total > actionIds.length;
  return (
    // flex-1 min-w-72: columns grow equally to fill the board's container width
    // (capped + centered by <main>'s max-w-screen-2xl, so they don't sprawl on a
    // 30" monitor), keeping matching widths and a symmetric right margin. The
    // 18rem floor is the old fixed width — once columns can't all fit, they stop
    // shrinking and the row's overflow-x-auto scrolls instead (mobile) (PROG-71).
    <section
      ref={setNodeRef}
      // snap-start: this column's left edge is the snap point the row settles on
      // when scrolled horizontally on a phone (see the row's snap-x/mandatory).
      className={`flex min-w-72 flex-1 snap-start flex-col rounded-lg p-2 ${isOver ? "bg-adobe-wash/30 ring-1 ring-adobe-light" : "bg-line/40"}`}
    >
      <h2 className="px-1 pb-2 text-xs font-medium uppercase tracking-wide font-mono text-ink-faint">
        {STATUS_LABELS[status]} ·{" "}
        {hiddenCount ? `${actionIds.length} of ${total}` : actionIds.length}
      </h2>
      <SortableContext items={actionIds} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-8 flex-1 flex-col gap-1.5">
          {actionIds.map((id) => {
            const action = actionsById.get(id);
            if (!action) return null;
            return (
              <BoardCard
                key={id}
                action={action}
                snapshot={snapshot}
                tags={tagsByAction.get(id) ?? []}
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
  action,
  snapshot,
  tags,
  hidden,
}: {
  action: WireAction;
  snapshot: SnapshotPayload;
  tags: WireTag[];
  hidden: boolean;
}) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({
    id: action.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-action-id={action.id}
      className={hidden || isDragging ? "opacity-30" : ""}
      // touchAction:manipulation keeps taps/holds responsive without blocking
      // board scroll (touch-action:none would kill scrolling over cards).
      // WebkitTouchCallout:none is the fix for PROG-79's drag bug: the card is a
      // <Link> (an <a>), and iOS Safari fires its native link callout — the
      // "Open / Copy Link / Share" preview menu — on long-press, which is the
      // exact press-and-hold gesture that starts a drag. The callout property is
      // inherited, so setting it here suppresses it for the anchor and its
      // contents; userSelect:none likewise stops the long-press text-selection
      // menu. A card is a drag handle / navigation target, not selectable copy.
      style={{
        touchAction: "manipulation",
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <Link href={`/action/${actionKeyOf(snapshot, action)}`} draggable={false}>
        <CardView action={action} snapshot={snapshot} tags={tags} />
      </Link>
    </div>
  );
}

function CardView({
  action,
  snapshot,
  tags,
  dragging = false,
}: {
  action: WireAction;
  snapshot: SnapshotPayload;
  tags: WireTag[];
  dragging?: boolean;
}) {
  const focus = snapshot.focuses.find((p) => p.id === action.focusId);
  // Step cards (PROG-124) read as nested-to-parent: indented with a moss
  // accent rail and a "↳ PARENT-KEY" breadcrumb, so they're distinct from the
  // top-level deliverables even though the column still sorts everything by rank.
  const parent = action.parentActionId
    ? snapshot.actions.find((i) => i.id === action.parentActionId)
    : undefined;
  const isChild = action.parentActionId !== null;
  return (
    <div
      className={`cursor-pointer rounded-md border border-line bg-card p-2.5 text-sm hover:border-line ${
        isChild ? "ml-4 border-l-2" : ""
      } ${dragging ? "rotate-1 shadow-lg" : "shadow-sm"}`}
      style={isChild ? { borderLeftColor: "var(--color-moss)" } : undefined}
    >
      <p className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-ink-faint">
          {parent && (
            <span className="text-moss" title="Step">
              ↳ {snapshot.focuses.find((p) => p.id === parent.focusId)?.keyPrefix ?? "?"}-
              {parent.number}{" "}
            </span>
          )}
          {focus?.keyPrefix ?? "?"}-{action.number}
        </span>
        <span className="text-xs text-ink-faint">{focus?.name}</span>
      </p>
      <p className="mt-1 font-medium leading-snug">{action.title}</p>
      {/* Estimate + tags get their own line so they don't crowd the date/priority
          footer below (PROG-61). */}
      {(action.estimate !== null || tags.length > 0) && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
          {action.estimate !== null && (
            <span className="rounded bg-line px-1">{action.estimate}</span>
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
      {(action.dueDate || action.priority !== "none") && (
        // Footer balances the two at-a-glance signals: the due date reads from
        // the bottom-left corner and the priority glyph is pinned bottom-right
        // (PROG-61) so date and priority never crowd each other.
        <div className="mt-2 flex items-end justify-between gap-2 text-xs text-ink-faint">
          <span className="min-w-0">{action.dueDate && <CardDueDate due={action.dueDate} />}</span>
          {action.priority !== "none" && (
            <PriorityIndicator priority={action.priority} className="shrink-0" />
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
