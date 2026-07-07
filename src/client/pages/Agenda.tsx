// The Agenda view (SPEC v2 §6): the time-driven cut of the snapshot. Every
// issue that has a due date and is still pending, sorted by due date ascending,
// grouped Overdue · Today · This week · Later (buckets from the owner's *local*
// today, since due dates are calendar days). Undated issues live on the board;
// done/canceled issues are never pending, so neither appears here.
//
// Filterable by product · arc · tag via URL params — the v1 board pattern — so
// "household tasks due this week" is one bookmark. Everything renders from the
// client store (SPEC v2 §7.1); inline mark-done / bump-due use the optimistic
// mutation template (no spinner).

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import type { WireIssue, WireTag, SnapshotPayload } from "../../shared/types";
import { loadQuickAddProduct, quickAddDueDate, saveQuickAddProduct } from "../agendaQuickAdd";
import { sortByName } from "../boardFilters";
import { type AgendaBucket, bucketOf, formatDueDate, relativeDue, todayISO } from "../dates";
import { STATUS_LABELS } from "../labels";
import PriorityIndicator from "../PriorityIndicator";
import { createIssue, issueKeyOf, setIssueStatus, updateIssue } from "../store";

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

  const tagsByIssue = useMemo(() => {
    const tagById = new Map(snapshot.tags.map((t) => [t.id, t]));
    const map = new Map<string, WireTag[]>();
    for (const link of snapshot.issueTags) {
      const tag = tagById.get(link.tagId);
      if (!tag) continue;
      const list = map.get(link.issueId) ?? [];
      list.push(tag);
      map.set(link.issueId, list);
    }
    return map;
  }, [snapshot.tags, snapshot.issueTags]);

  // Dated, still-pending issues matching the active filters, ascending by due
  // date (string compare is correct for YYYY-MM-DD), tiebroken by key.
  const dated = useMemo(() => {
    const productById = new Map(snapshot.products.map((p) => [p.id, p]));
    const keyOf = (i: WireIssue) =>
      `${productById.get(i.productId)?.keyPrefix ?? ""}-${String(i.number).padStart(8, "0")}`;
    return snapshot.issues
      .filter((i) => i.dueDate)
      .filter((i) => i.status !== "done" && i.status !== "canceled")
      .filter((i) => !filters.product || i.productId === filters.product)
      .filter((i) => !filters.arc || i.arcId === filters.arc)
      .filter((i) => !filters.tag || (tagsByIssue.get(i.id) ?? []).some((t) => t.id === filters.tag))
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || keyOf(a).localeCompare(keyOf(b)));
  }, [snapshot.issues, snapshot.products, filters, tagsByIssue]);

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
          options={sortByName(snapshot.products.filter((p) => !p.archivedAt)).map((p) => [
            p.id,
            p.name,
          ])}
          onChange={(v) => setParam("product", v)}
        />
        <FilterSelect
          label="Arc"
          value={filters.arc}
          options={sortByName(
            snapshot.arcs
              .filter((a) => !a.archivedAt)
              .filter((a) => !filters.product || a.productId === filters.product),
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
                    snapshot={snapshot}
                    tags={tagsByIssue.get(issue.id) ?? []}
                    overdue={bucket.key === "overdue"}
                    today={today}
                  />
                ))}
              </ul>
              {/* Quick-add (PROG-89): capture straight into this date bucket.
                  Not on Overdue — an issue can't be born already late. */}
              {bucket.key !== "overdue" && (
                <QuickAddRow bucket={bucket.key} snapshot={snapshot} filters={filters} today={today} />
              )}
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

// Quick-add input under a date grouping (PROG-89): type a title, Enter, and
// the issue is created pre-dated for the bucket it was typed under — Today →
// today, This week → the window's last day (today+6), Later → just beyond it
// (today+7). Created as `todo` (a dated capture is committed work, not
// backlog) with the optimistic createIssue, so the new row appears in the
// group instantly. The product comes from the inline picker: it follows the
// active Product filter when one is set, otherwise it remembers the last
// product quick-added into (localStorage, fail-soft). An active Arc filter is
// inherited when it belongs to the chosen product, so a filtered agenda
// captures into what you're looking at.
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
  const products = useMemo(
    () => sortByName(snapshot.products.filter((p) => !p.archivedAt)),
    [snapshot.products],
  );
  const [productId, setProductId] = useState<string>(() => {
    const saved = loadQuickAddProduct();
    if (filters.product) return filters.product;
    if (saved && products.some((p) => p.id === saved)) return saved;
    return products[0]?.id ?? "";
  });
  // The picker tracks the Product filter while one is active.
  useEffect(() => {
    if (filters.product) setProductId(filters.product);
  }, [filters.product]);

  const due = quickAddDueDate(bucket, today);

  const submit = () => {
    const t = title.trim();
    if (!t || !productId || !due) return;
    const arcId =
      filters.arc &&
      snapshot.arcs.some((a) => a.id === filters.arc && a.productId === productId)
        ? filters.arc
        : null;
    createIssue({
      title: t,
      productId,
      repoId: null,
      arcId,
      parentIssueId: null,
      status: "todo",
      priority: "none",
      estimate: null,
      dueDate: due,
    });
    saveQuickAddProduct(productId);
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
        placeholder={due ? `New issue — due ${bucket === "today" ? "today" : formatDueDate(due)}, Enter to add` : ""}
        aria-label={`New issue due ${due ?? ""}`}
        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-line focus:bg-card focus:outline-none"
      />
      <select
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        title="Product for the new issue"
        aria-label="Product for the new issue"
        className="max-w-36 shrink-0 truncate rounded border border-line bg-card px-1.5 py-1 text-xs text-ink-faint hover:text-ink-soft focus:outline-none"
      >
        {products.map((p) => (
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
  issue,
  snapshot,
  tags,
  overdue,
  today,
}: {
  issue: WireIssue;
  snapshot: SnapshotPayload;
  tags: WireTag[];
  overdue: boolean;
  today: string;
}) {
  const key = issueKeyOf(snapshot, issue);
  const product = snapshot.products.find((p) => p.id === issue.productId);
  const arc = issue.arcId ? snapshot.arcs.find((a) => a.id === issue.arcId) : null;
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
