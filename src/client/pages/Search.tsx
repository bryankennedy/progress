// The search page (PROG-130): the deeper-dive surface to the `/` modal. Same
// two-wave model — title/description hits come from the in-memory store, comment
// hits stream in from /api/search — but here results are filterable by the same
// dimensions as the board (status, product/arc/repo, tag, priority) and the
// query + filters live in the URL so a search is bookmarkable. The `/` modal's
// "Open the search page" link hands its text here via ?q=.

import { useMemo } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "../../shared/constants";
import type { WireIssue, WorkspacePayload } from "../../shared/types";
import { FILTER_NONE, matchesNullableId, sortByName } from "../boardFilters";
import FilterSelect from "../FilterSelect";
import {
  containerLabel,
  highlight,
  queryTerms,
  searchContainers,
  searchIssues,
  type Segment,
} from "../search";
import { PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import PriorityIndicator from "../PriorityIndicator";
import { issueKeyOf, useCommentSearch } from "../store";

const FILTER_KEYS = ["initiative", "product", "repo", "arc", "tag", "priority", "status"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Partial<Record<FilterKey, string>>;

function parseFilters(search: string): { q: string; filters: Filters } {
  const params = new URLSearchParams(search);
  const filters: Filters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  return { q: params.get("q") ?? "", filters };
}

export default function Search({ workspace }: { workspace: WorkspacePayload }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const { q, filters } = useMemo(() => parseFilters(search), [search]);
  const terms = useMemo(() => queryTerms(q), [q]);

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(search);
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    navigate(qs ? `/search?${qs}` : "/search", { replace: true });
  };

  // tag → issue lookup for the tag filter (mirrors the board).
  const tagsByIssue = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of workspace.issueTags) {
      const set = map.get(link.issueId) ?? new Set<string>();
      set.add(link.tagId);
      map.set(link.issueId, set);
    }
    return map;
  }, [workspace.issueTags]);

  const productById = useMemo(
    () => new Map(workspace.products.map((p) => [p.id, p])),
    [workspace.products],
  );

  // Does an issue pass the active filters? Used for both issue and comment hits.
  const passes = useMemo(() => {
    return (issue: WireIssue): boolean => {
      if (filters.initiative) {
        const product = productById.get(issue.productId);
        if (!product || product.initiativeId !== filters.initiative) return false;
      }
      if (filters.product && issue.productId !== filters.product) return false;
      // Nullable containers (PROG-76): "none" matches issues with no repo/arc.
      if (filters.repo && !matchesNullableId(issue.repoId, filters.repo)) return false;
      if (filters.arc && !matchesNullableId(issue.arcId, filters.arc)) return false;
      if (filters.priority && issue.priority !== filters.priority) return false;
      if (filters.status && issue.status !== filters.status) return false;
      if (filters.tag) {
        const tags = tagsByIssue.get(issue.id);
        const ok =
          filters.tag === FILTER_NONE ? !tags || tags.size === 0 : (tags?.has(filters.tag) ?? false);
        if (!ok) return false;
      }
      return true;
    };
  }, [filters, productById, tagsByIssue]);

  const issueHits = useMemo(
    () => searchIssues(workspace, q, 0).filter((h) => passes(h.issue)),
    [workspace, q, passes],
  );
  const containerHits = useMemo(() => searchContainers(workspace, q, 0), [workspace, q]);

  const { data: comments, isFetching } = useCommentSearch(q);
  // Resolve comment hits to issues and apply the same filters.
  const commentHits = useMemo(() => {
    return (comments?.hits ?? [])
      .map((hit) => {
        const issue = workspace.issues.find((i) => i.id === hit.issueId);
        return issue ? { ...hit, issue } : null;
      })
      .filter((h): h is NonNullable<typeof h> => h !== null && passes(h.issue));
  }, [comments, workspace.issues, passes]);

  const filtersActive = FILTER_KEYS.some((k) => filters[k]);

  return (
    <div className="mx-auto max-w-3xl">
      <input
        autoFocus
        value={q}
        onChange={(e) => setParam("q", e.target.value || null)}
        placeholder="Search issues, descriptions, comments…"
        className="w-full rounded-lg border border-line bg-card px-4 py-3 text-sm focus:border-ink-faint focus:outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <FilterSelect
          label="Status"
          value={filters.status}
          options={ISSUE_STATUSES.map((s) => [s, STATUS_LABELS[s]])}
          onChange={(v) => setParam("status", v)}
        />
        <FilterSelect
          label="Product"
          value={filters.product}
          options={sortByName(workspace.products.filter((p) => !p.archivedAt)).map((p) => [
            p.id,
            p.name,
          ])}
          onChange={(v) => setParam("product", v)}
        />
        <FilterSelect
          label="Arc"
          nullable
          value={filters.arc}
          options={sortByName(
            workspace.arcs
              .filter((a) => !a.archivedAt)
              .filter((a) => !filters.product || a.productId === filters.product),
          ).map((a) => [a.id, a.name])}
          onChange={(v) => setParam("arc", v)}
        />
        <FilterSelect
          label="Repo"
          nullable
          value={filters.repo}
          options={sortByName(
            workspace.repos
              .filter((r) => !r.archivedAt)
              .filter((r) => !filters.product || r.productId === filters.product),
          ).map((r) => [r.id, r.name])}
          onChange={(v) => setParam("repo", v)}
        />
        <FilterSelect
          label="Tag"
          nullable
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
        {filtersActive && (
          <button
            // Keep the query, drop every filter.
            onClick={() =>
              navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search", { replace: true })
            }
            className="text-xs text-ink-faint underline hover:text-ink-soft"
          >
            Clear filters
          </button>
        )}
      </div>

      {terms.length === 0 ? (
        <p className="mt-10 text-center text-sm text-ink-faint">
          Search titles and descriptions instantly; comments stream in from the server.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {containerHits.length > 0 && (
            <Section title="Containers" count={containerHits.length}>
              {containerHits.map((hit) => (
                <Link
                  key={hit.id}
                  href={hit.href}
                  className="flex items-center justify-between gap-3 rounded-md border border-line bg-card px-3 py-2 text-sm hover:border-ink-faint"
                >
                  <span className="min-w-0 truncate">
                    <Highlighted segments={highlight(hit.name, terms)} />
                  </span>
                  <span className="shrink-0 text-xs text-ink-faint">{containerLabel(hit.kind)}</span>
                </Link>
              ))}
            </Section>
          )}

          <Section title="Issues" count={issueHits.length}>
            {issueHits.length === 0 ? (
              <Empty>No issues match.</Empty>
            ) : (
              issueHits.map((hit) => {
                const key = issueKeyOf(workspace, hit.issue);
                const product = workspace.products.find((p) => p.id === hit.issue.productId);
                return (
                  <Link
                    key={hit.issue.id}
                    href={`/issue/${key}`}
                    className="block rounded-md border border-line bg-card px-3 py-2 text-sm hover:border-ink-faint"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-mono text-xs text-ink-faint">{key}</span>{" "}
                        <Highlighted segments={highlight(hit.issue.title, terms)} />
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-ink-faint">
                        {product?.name}
                        <span>· {STATUS_LABELS[hit.issue.status]}</span>
                        {hit.issue.priority !== "none" && (
                          <PriorityIndicator priority={hit.issue.priority} />
                        )}
                      </span>
                    </div>
                    {!hit.inTitle && hit.issue.description && (
                      <p className="mt-1 truncate text-xs text-ink-soft">
                        <Highlighted segments={highlight(descSnippet(hit.issue.description, terms), terms)} />
                      </p>
                    )}
                  </Link>
                );
              })
            )}
          </Section>

          <Section
            title="Comments"
            count={commentHits.length}
            loading={isFetching}
            note={comments?.truncated ? "showing the most recent matches" : undefined}
          >
            {commentHits.length === 0 ? (
              <Empty>{isFetching ? "Searching comments…" : "No comments match."}</Empty>
            ) : (
              commentHits.map((hit) => {
                const key = issueKeyOf(workspace, hit.issue);
                return (
                  <Link
                    key={hit.commentId}
                    href={`/issue/${key}`}
                    className="block rounded-md border border-line bg-card px-3 py-2 text-sm hover:border-ink-faint"
                  >
                    <span className="font-mono text-xs text-ink-faint">{key}</span>{" "}
                    <span className="text-ink-faint">{hit.issue.title}</span>
                    <p className="mt-1 text-xs text-ink-soft">
                      <Highlighted segments={highlight(hit.snippet, terms)} />
                    </p>
                  </Link>
                );
              })
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

// A ~140-char window of the description around the first matched term, so a
// description-only hit shows WHY it matched without dumping the whole field.
function descSnippet(description: string, terms: string[]): string {
  const lower = description.toLowerCase();
  let first = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (first === -1 || idx < first)) first = idx;
  }
  if (first === -1) return description.slice(0, 140);
  const start = Math.max(0, first - 50);
  const slice = description.slice(start, start + 140).trim();
  return `${start > 0 ? "… " : ""}${slice}${start + 140 < description.length ? " …" : ""}`;
}

function Section({
  title,
  count,
  loading,
  note,
  children,
}: {
  title: string;
  count: number;
  loading?: boolean;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
        {title} · {count}
        {note && <span className="normal-case tracking-normal text-ink-faint">({note})</span>}
        {loading && (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-ink-faint border-t-transparent" />
        )}
      </h2>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-line px-3 py-3 text-xs text-ink-faint">{children}</p>;
}

function Highlighted({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark key={i} className="rounded bg-adobe-wash px-0.5 text-adobe-deep">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
