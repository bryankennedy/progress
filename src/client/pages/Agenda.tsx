// The Agenda view (SPEC v2 §6): the time-driven cut of the workspace. Every
// issue that has a due date and is still pending, sorted by due date ascending,
// grouped Overdue · Today · This week · Later (buckets from the owner's *local*
// today, since due dates are calendar days). Undated issues live on the board;
// done/canceled issues are never pending, so neither appears here.
//
// Filterable by product · arc · tag via URL params — the v1 board pattern — so
// "household tasks due this week" is one bookmark. Everything renders from the
// client store (SPEC v2 §7.1); inline mark-done / bump-due use the optimistic
// mutation template (no spinner).

import { useMemo } from "react";
import { Link, useLocation, useSearch } from "wouter";
import type { WireIssue, WireTag, WorkspacePayload } from "../../shared/types";
import { type AgendaBucket, bucketOf, formatDueDate, relativeDue, todayISO } from "../dates";
import { STATUS_LABELS } from "../labels";
import PriorityIndicator from "../PriorityIndicator";
import { issueKeyOf, setIssueStatus, updateIssue } from "../store";

const FILTER_KEYS = ["product", "arc", "tag"] as const;
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

export default function Agenda({ workspace }: { workspace: WorkspacePayload }) {
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

  // Dated, still-pending issues matching the active filters, ascending by due
  // date (string compare is correct for YYYY-MM-DD), tiebroken by key.
  const dated = useMemo(() => {
    const productById = new Map(workspace.products.map((p) => [p.id, p]));
    const keyOf = (i: WireIssue) =>
      `${productById.get(i.productId)?.keyPrefix ?? ""}-${String(i.number).padStart(8, "0")}`;
    return workspace.issues
      .filter((i) => i.dueDate)
      .filter((i) => i.status !== "done" && i.status !== "canceled")
      .filter((i) => !filters.product || i.productId === filters.product)
      .filter((i) => !filters.arc || i.arcId === filters.arc)
      .filter((i) => !filters.tag || (tagsByIssue.get(i.id) ?? []).some((t) => t.id === filters.tag))
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || keyOf(a).localeCompare(keyOf(b)));
  }, [workspace.issues, workspace.products, filters, tagsByIssue]);

  const grouped = useMemo(() => {
    const groups = new Map<AgendaBucket, WireIssue[]>(BUCKETS.map((b) => [b.key, []]));
    for (const issue of dated) groups.get(bucketOf(issue.dueDate!, today))!.push(issue);
    return groups;
  }, [dated, today]);

  const filtersActive = FILTER_KEYS.some((k) => filters[k]);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
        <p className="text-xs text-ink-faint">
          {dated.length} dated {dated.length === 1 ? "issue" : "issues"} · sorted by due date
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <FilterSelect
          label="Product"
          value={filters.product}
          options={workspace.products.filter((p) => !p.archivedAt).map((p) => [p.id, p.name])}
          onChange={(v) => setParam("product", v)}
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
          const issues = grouped.get(bucket.key)!;
          if (issues.length === 0) return null;
          return (
            <section key={bucket.key}>
              <h2 className={`text-sm font-medium uppercase tracking-wide font-mono ${bucket.accent}`}>
                {bucket.label} · {issues.length}
              </h2>
              <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-card">
                {issues.map((issue) => (
                  <AgendaRow
                    key={issue.id}
                    issue={issue}
                    workspace={workspace}
                    tags={tagsByIssue.get(issue.id) ?? []}
                    overdue={bucket.key === "overdue"}
                    today={today}
                  />
                ))}
              </ul>
            </section>
          );
        })}
        {dated.length === 0 && (
          <p className="text-sm text-ink-faint">
            Nothing due{filtersActive ? " for this filter" : ""}. Add a due date to an issue and it
            shows up here.
          </p>
        )}
      </div>
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
  issue,
  workspace,
  tags,
  overdue,
  today,
}: {
  issue: WireIssue;
  workspace: WorkspacePayload;
  tags: WireTag[];
  overdue: boolean;
  today: string;
}) {
  const key = issueKeyOf(workspace, issue);
  const product = workspace.products.find((p) => p.id === issue.productId);
  const arc = issue.arcId ? workspace.arcs.find((a) => a.id === issue.arcId) : null;
  const due = issue.dueDate!;

  return (
    // Two lines so the title always gets the full row width (the metadata and
    // inline actions used to crowd it down to an ellipsis): line 1 is the
    // title; line 2 is product/arc · status · due, plus the bump/done actions.
    <li data-issue-id={issue.id} className={`px-3 py-2.5 text-sm ${overdue ? "bg-danger-bg/50" : ""}`}>
      <div className="flex items-center gap-2.5">
        <PriorityIndicator priority={issue.priority} />
        <Link
          href={`/issue/${key}`}
          className="shrink-0 font-mono text-xs text-ink-faint hover:text-ink-soft"
        >
          {key}
        </Link>
        <Link
          href={`/issue/${key}`}
          className="min-w-0 flex-1 truncate font-medium hover:text-adobe-deep"
        >
          {issue.title}
        </Link>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-[22px] text-xs text-ink-faint">
        <span className="truncate">
          {product?.name}
          {arc && <span className="text-ink-faint"> · {arc.name}</span>}
        </span>
        <span className="text-ink-faint">·</span>
        <span>{STATUS_LABELS[issue.status]}</span>
        <span className="text-ink-faint">·</span>
        <span className={`font-medium ${overdue ? "text-danger" : "text-ink-soft"}`} title={due}>
          {relativeDue(due, today)} · {formatDueDate(due)}
        </span>
        {/* Cheap inline actions (SPEC v2 §6): bump the due date, mark done. */}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <input
            type="date"
            value={due}
            onChange={(e) => updateIssue(issue.id, { dueDate: e.target.value || null })}
            title="Bump the due date"
            className="rounded border border-line bg-card px-1.5 py-0.5 text-ink-soft hover:border-ink-faint"
          />
          <button
            onClick={() => setIssueStatus(issue.id, "done")}
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
