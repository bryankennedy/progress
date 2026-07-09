// The Agenda view (SPEC v2 §6): the time-driven cut of the snapshot. Every
// action that has a due date and is still pending, sorted by due date ascending,
// grouped Overdue · Today · This week · Later (buckets from the owner's *local*
// today, since due dates are calendar days). Undated actions live on the board;
// done/canceled actions are never pending, so neither appears here.
//
// Filterable by focus · arc · tag via URL params — the v1 board pattern — so
// "household tasks due this week" is one bookmark. Everything renders from the
// client store (SPEC v2 §7.1); inline mark-done / bump-due use the optimistic
// mutation template (no spinner).

import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import type { WireAction, WireTag, SnapshotPayload } from "../../shared/types";
import {
  inheritArcId,
  loadQuickAddFocus,
  quickAddDueDate,
  saveQuickAddFocus,
} from "../agendaQuickAdd";
import { sortByName } from "../boardFilters";
import { type AgendaBucket, bucketOf, formatDueDate, relativeDue, todayISO } from "../dates";
import { tagsByAction as buildTagsByAction } from "../tags";
import { STATUS_LABELS } from "../labels";
import PriorityIndicator from "../PriorityIndicator";
import { createAction, actionKeyOf, setActionStatus, updateAction } from "../store";

const FILTER_KEYS = ["focus", "arc", "tag"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Partial<Record<FilterKey, string>>;

function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const filters: Filters = {};
  for (const key of FILTER_KEYS) {
    const v = params.get(key);
    if (v) filters[key] = v;
  }
  return filters;
}

// Order and presentation of the four buckets. Overdue is visually distinct.
const BUCKETS: { key: AgendaBucket; label: string; accent: string }[] = [
  { key: "overdue", label: "Overdue", accent: "text-danger" },
  { key: "today", label: "Today", accent: "text-ink" },
  { key: "week", label: "This week", accent: "text-ink" },
  { key: "later", label: "Later", accent: "text-ink-soft" },
];

export default function Agenda({ snapshot }: { snapshot: SnapshotPayload }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const filters = useMemo(() => parseFilters(search), [search]);
  const today = todayISO();

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(search);
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    navigate(qs ? `/agenda?${qs}` : "/agenda", { replace: true });
  };

  const tagsByAction = useMemo(
    () => buildTagsByAction(snapshot),
    [snapshot.tags, snapshot.actionTags],
  );

  // Dated, still-pending actions matching the active filters, ascending by due
  // date (string compare is correct for YYYY-MM-DD), tiebroken by key.
  const dated = useMemo(() => {
    const focusById = new Map(snapshot.focuses.map((p) => [p.id, p]));
    const keyOf = (i: WireAction) =>
      `${focusById.get(i.focusId)?.keyPrefix ?? ""}-${String(i.number).padStart(8, "0")}`;
    return snapshot.actions
      .filter((i) => i.dueDate)
      .filter((i) => i.status !== "done" && i.status !== "canceled")
      .filter((i) => !filters.focus || i.focusId === filters.focus)
      .filter((i) => !filters.arc || i.arcId === filters.arc)
      .filter(
        (i) => !filters.tag || (tagsByAction.get(i.id) ?? []).some((t) => t.id === filters.tag),
      )
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || keyOf(a).localeCompare(keyOf(b)));
  }, [snapshot.actions, snapshot.focuses, filters, tagsByAction]);

  const grouped = useMemo(() => {
    const groups = new Map<AgendaBucket, WireAction[]>(BUCKETS.map((b) => [b.key, []]));
    for (const action of dated) groups.get(bucketOf(action.dueDate!, today))!.push(action);
    return groups;
  }, [dated, today]);

  const filtersActive = FILTER_KEYS.some((k) => filters[k]);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
        <p className="text-xs text-ink-faint">
          {dated.length} dated {dated.length === 1 ? "action" : "actions"} · sorted by due date
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <FilterSelect
          label="Focus"
          value={filters.focus}
          options={sortByName(snapshot.focuses.filter((p) => !p.archivedAt)).map((p) => [
            p.id,
            p.name,
          ])}
          onChange={(v) => setParam("focus", v)}
        />
        <FilterSelect
          label="Arc"
          value={filters.arc}
          options={sortByName(
            snapshot.arcs
              .filter((a) => !a.archivedAt)
              .filter((a) => !filters.focus || a.focusId === filters.focus),
          ).map((a) => [a.id, a.name])}
          onChange={(v) => setParam("arc", v)}
        />
        <FilterSelect
          label="Tag"
          value={filters.tag}
          options={sortByName(snapshot.tags).map((t) => [t.id, t.name])}
          onChange={(v) => setParam("tag", v)}
        />
        {filtersActive && (
          <button
            onClick={() => navigate("/agenda", { replace: true })}
            className="text-xs text-ink-faint underline hover:text-ink-soft"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-6 space-y-8">
        {BUCKETS.map((bucket) => {
          const actions = grouped.get(bucket.key)!;
          if (actions.length === 0) return null;
          return (
            <section key={bucket.key}>
              <h2
                className={`text-sm font-medium uppercase tracking-wide font-mono ${bucket.accent}`}
              >
                {bucket.label} · {actions.length}
              </h2>
              <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-card">
                {actions.map((action) => (
                  <AgendaRow
                    key={action.id}
                    action={action}
                    snapshot={snapshot}
                    tags={tagsByAction.get(action.id) ?? []}
                    overdue={bucket.key === "overdue"}
                    today={today}
                  />
                ))}
              </ul>
              {/* Quick-add (PROG-89): capture straight into this date bucket.
                  Not on Overdue — an action can't be born already late. */}
              {bucket.key !== "overdue" && (
                <QuickAddRow
                  bucket={bucket.key}
                  snapshot={snapshot}
                  filters={filters}
                  today={today}
                />
              )}
            </section>
          );
        })}
        {dated.length === 0 && (
          <p className="text-sm text-ink-faint">
            Nothing due{filtersActive ? " for this filter" : ""}. Add a due date to an action and it
            shows up here.
          </p>
        )}
      </div>
    </div>
  );
}

// Quick-add input under a date grouping (PROG-89): type a title, Enter, and
// the action is created pre-dated for the bucket it was typed under — Today →
// today, This week → the window's last day (today+6), Later → just beyond it
// (today+7). Created as `todo` (a dated capture is committed work, not
// backlog) with the optimistic createAction, so the new row appears in the
// group instantly. The focus comes from the inline picker: it follows the
// active Focus filter when one is set, otherwise it remembers the last
// focus quick-added into (localStorage, fail-soft). Active Arc (when it
// belongs to the chosen focus) and Tag filters are inherited (PROG-89b), so
// a filtered agenda captures into what you're looking at — and the capture
// stays visible under the filter instead of silently vanishing.
function QuickAddRow({
  bucket,
  snapshot,
  filters,
  today,
}: {
  bucket: AgendaBucket;
  snapshot: SnapshotPayload;
  filters: Filters;
  today: string;
}) {
  const [title, setTitle] = useState("");
  const focuses = useMemo(
    () => sortByName(snapshot.focuses.filter((p) => !p.archivedAt)),
    [snapshot.focuses],
  );
  const [focusId, setFocusId] = useState<string>(() => {
    const saved = loadQuickAddFocus();
    if (filters.focus) return filters.focus;
    if (saved && focuses.some((p) => p.id === saved)) return saved;
    return focuses[0]?.id ?? "";
  });
  // The picker tracks the Focus filter while one is active. Synced during
  // render (prev-value pattern, like the search page's pagination reset) so
  // there's no post-render setState frame.
  const [prevFilterFocus, setPrevFilterFocus] = useState(filters.focus);
  if (filters.focus !== prevFilterFocus) {
    setPrevFilterFocus(filters.focus);
    if (filters.focus) setFocusId(filters.focus);
  }

  const due = quickAddDueDate(bucket, today);

  const submit = () => {
    const t = title.trim();
    if (!t || !focusId || !due) return;
    createAction({
      title: t,
      focusId,
      repoId: null,
      arcId: inheritArcId(filters.arc, focusId, snapshot.arcs),
      parentActionId: null,
      status: "todo",
      priority: "none",
      estimate: null,
      dueDate: due,
      // Inherit the active Tag filter too (PROG-89b) — otherwise the untagged
      // capture is filtered out the instant it's created and silently vanishes.
      tagIds: filters.tag ? [filters.tag] : undefined,
    });
    saveQuickAddFocus(focusId);
    setTitle(""); // input keeps focus — capture the next one immediately
  };

  return (
    <div className="mt-2 flex items-center gap-2 pl-1">
      <span className="text-ink-faint/50" aria-hidden>
        ＋
      </span>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={
          due
            ? `New action — due ${bucket === "today" ? "today" : formatDueDate(due)}, Enter to add`
            : ""
        }
        aria-label={`New action due ${due ?? ""}`}
        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-line focus:bg-card focus:outline-none"
      />
      <select
        value={focusId}
        onChange={(e) => setFocusId(e.target.value)}
        title="Focus for the new action"
        aria-label="Focus for the new action"
        className="max-w-36 shrink-0 truncate rounded border border-line bg-card px-1.5 py-1 text-xs text-ink-faint hover:text-ink-soft focus:outline-none"
      >
        {focuses.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
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

function AgendaRow({
  action,
  snapshot,
  tags,
  overdue,
  today,
}: {
  action: WireAction;
  snapshot: SnapshotPayload;
  tags: WireTag[];
  overdue: boolean;
  today: string;
}) {
  const key = actionKeyOf(snapshot, action);
  const focus = snapshot.focuses.find((p) => p.id === action.focusId);
  const arc = action.arcId ? snapshot.arcs.find((a) => a.id === action.arcId) : null;
  const due = action.dueDate!;

  return (
    // Two lines so the title always gets the full row width (the metadata and
    // inline actions used to crowd it down to an ellipsis): line 1 is the
    // title; line 2 is focus/arc · status · due, plus the bump/done actions.
    <li
      data-action-id={action.id}
      className={`px-3 py-2.5 text-sm ${overdue ? "bg-danger-bg/50" : ""}`}
    >
      <div className="flex items-center gap-2.5">
        <PriorityIndicator priority={action.priority} />
        <Link
          href={`/action/${key}`}
          className="shrink-0 font-mono text-xs text-ink-faint hover:text-ink-soft"
        >
          {key}
        </Link>
        <Link
          href={`/action/${key}`}
          className="min-w-0 flex-1 truncate font-medium hover:text-adobe-deep"
        >
          {action.title}
        </Link>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-[22px] text-xs text-ink-faint">
        <span className="truncate">
          {focus?.name}
          {arc && <span className="text-ink-faint"> · {arc.name}</span>}
        </span>
        <span className="text-ink-faint">·</span>
        <span>{STATUS_LABELS[action.status]}</span>
        <span className="text-ink-faint">·</span>
        <span className={`font-medium ${overdue ? "text-danger" : "text-ink-soft"}`} title={due}>
          {relativeDue(due, today)} · {formatDueDate(due)}
        </span>
        {/* Cheap inline actions (SPEC v2 §6): bump the due date, mark done. */}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <input
            type="date"
            value={due}
            onChange={(e) => updateAction(action.id, { dueDate: e.target.value || null })}
            title="Bump the due date"
            className="rounded border border-line bg-card px-1.5 py-0.5 text-ink-soft hover:border-ink-faint"
          />
          <button
            onClick={() => setActionStatus(action.id, "done")}
            title="Mark done"
            className="rounded border border-line bg-card px-2 py-0.5 text-ink-soft hover:border-moss hover:text-moss-deep"
          >
            ✓ Done
          </button>
        </span>
      </div>
    </li>
  );
}
