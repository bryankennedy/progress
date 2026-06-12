// The global "My Work" board (SPEC §4): one kanban across all initiatives
// and products. Columns are the fixed statuses; Backlog hides behind a
// toggle by default (open question #2 default). Filters live in URL query
// params so any filtered board is bookmarkable — this is how the global
// board covers the deferred per-product/per-arc boards.

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssuePriority,
  type IssueStatus,
} from "../../shared/constants";
import type { WireIssue, WireTag, WorkspacePayload } from "../../shared/types";
import { openCreateIssue } from "../commands/controller";
import { PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import { issueKeyOf, loadStats, setIssueStatus } from "../store";

const FILTER_KEYS = ["initiative", "product", "repo", "arc", "tag", "priority"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Partial<Record<FilterKey, string>> & { backlog?: boolean };

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

  const productById = useMemo(
    () => new Map(workspace.products.map((p) => [p.id, p])),
    [workspace.products],
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
    const keyOf = (i: WireIssue) =>
      `${productById.get(i.productId)?.keyPrefix ?? ""}-${String(i.number).padStart(8, "0")}`;
    for (const group of groups.values())
      group.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    return groups;
  }, [workspace.issues, workspace.products, filters, tagsByIssue, productById]);

  // Mouse: a distance constraint keeps plain clicks (card → issue page) from
  // starting a drag. Touch: a hold-delay keeps swipes scrolling the board
  // horizontally — press-and-hold a card to drag it (SPEC §4 mobile).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIssue = draggingId
    ? workspace.issues.find((i) => i.id === draggingId)
    : undefined;

  const onDragStart = (e: DragStartEvent) => setDraggingId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setDraggingId(null);
    const issue = workspace.issues.find((i) => i.id === String(e.active.id));
    const target = e.over?.id as IssueStatus | undefined;
    if (issue && target && target !== issue.status) setIssueStatus(issue.id, target);
  };

  const columns = ISSUE_STATUSES.filter((s) => s !== "backlog" || filters.backlog);
  const shownCount = columns.reduce((n, s) => n + visibleByStatus.get(s)!.length, 0);
  const filtersActive = FILTER_KEYS.some((k) => filters[k]);

  return (
    <>
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
        <p className="text-xs text-stone-400">
          {shownCount} issues on board · {workspace.issues.length} total · loaded in{" "}
          {Math.round(loadStats.fetchMs)} ms · ⌘K for commands
        </p>
        <button
          onClick={() => openCreateIssue()}
          className="ml-auto rounded bg-stone-900 px-3 py-1 text-sm text-white hover:bg-stone-700"
        >
          New issue <span className="text-stone-400">(C)</span>
        </button>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        {/* Archived containers stay out of the dropdowns (D26); their issues
            still render, so nothing silently disappears from the board. */}
        <FilterSelect
          label="Initiative"
          value={filters.initiative}
          options={workspace.initiatives
            .filter((i) => !i.archivedAt)
            .map((i) => [i.id, i.name])}
          onChange={(v) => setParam("initiative", v)}
        />
        <FilterSelect
          label="Product"
          value={filters.product}
          options={workspace.products
            .filter((p) => !p.archivedAt)
            .filter((p) => !filters.initiative || p.initiativeId === filters.initiative)
            .map((p) => [p.id, p.name])}
          onChange={(v) => setParam("product", v)}
        />
        <FilterSelect
          label="Repo"
          value={filters.repo}
          options={workspace.repos
            .filter((r) => !r.archivedAt)
            .filter((r) => !filters.product || r.productId === filters.product)
            .map((r) => [r.id, r.name])}
          onChange={(v) => setParam("repo", v)}
        />
        <FilterSelect
          label="Arc"
          value={filters.arc}
          options={workspace.arcs
            .filter((a) => !a.archivedAt)
            .filter((a) => !filters.product || a.productId === filters.product)
            .map((a) => [a.id, a.name])}
          onChange={(v) => setParam("arc", v)}
        />
        <FilterSelect
          label="Tag"
          value={filters.tag}
          options={workspace.tags.map((t) => [t.id, t.name])}
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
              ? "border-stone-400 bg-stone-100 text-stone-700"
              : "border-stone-200 bg-white text-stone-400 hover:border-stone-400"
          }`}
        >
          {filters.backlog ? "Hide backlog" : "Show backlog"}
        </button>
        {filtersActive && (
          <button
            onClick={() => navigate(filters.backlog ? "/?backlog=1" : "/", { replace: true })}
            className="text-xs text-stone-400 underline hover:text-stone-600"
          >
            Clear filters
          </button>
        )}
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="mt-5 flex items-start gap-3 overflow-x-auto pb-6">
          {columns.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              issues={visibleByStatus.get(status)!}
              workspace={workspace}
              tagsByIssue={tagsByIssue}
              draggingId={draggingId}
            />
          ))}
        </div>
        <DragOverlay>
          {draggingIssue && (
            <CardView
              issue={draggingIssue}
              workspace={workspace}
              tags={tagsByIssue.get(draggingIssue.id) ?? []}
              dragging
            />
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
        value ? "border-stone-400 bg-stone-100 text-stone-700" : "border-stone-200 bg-white text-stone-500"
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
  issues,
  workspace,
  tagsByIssue,
  draggingId,
}: {
  status: IssueStatus;
  issues: WireIssue[];
  workspace: WorkspacePayload;
  tagsByIssue: Map<string, WireTag[]>;
  draggingId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={`w-72 shrink-0 rounded-lg p-2 ${isOver ? "bg-sky-50 ring-1 ring-sky-200" : "bg-stone-100/60"}`}
    >
      <h2 className="px-1 pb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
        {STATUS_LABELS[status]} · {issues.length}
      </h2>
      <div className="flex min-h-8 flex-col gap-1.5">
        {issues.map((issue) => (
          <BoardCard
            key={issue.id}
            issue={issue}
            workspace={workspace}
            tags={tagsByIssue.get(issue.id) ?? []}
            hidden={draggingId === issue.id}
          />
        ))}
      </div>
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
  const { setNodeRef, listeners, attributes } = useDraggable({ id: issue.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-issue-id={issue.id}
      className={hidden ? "opacity-30" : ""}
      // Keeps taps/holds responsive on touch without blocking board scroll
      // (safe with the hold-delay sensor; touch-action:none would kill
      // scrolling over cards).
      style={{ touchAction: "manipulation" }}
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
      className={`cursor-pointer rounded-md border border-stone-200 bg-white p-2.5 text-sm hover:border-stone-300 ${
        dragging ? "rotate-1 shadow-lg" : "shadow-sm"
      }`}
    >
      <p className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-stone-400">
          {product?.keyPrefix ?? "?"}-{issue.number}
        </span>
        <span className="text-xs text-stone-400">{product?.name}</span>
      </p>
      <p className="mt-1 font-medium leading-snug">{issue.title}</p>
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-400">
        {issue.priority !== "none" && <span>{PRIORITY_LABELS[issue.priority]}</span>}
        {issue.estimate !== null && (
          <span className="rounded bg-stone-100 px-1">{issue.estimate}</span>
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
    </div>
  );
}
