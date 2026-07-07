// The search page (PROG-130): the deeper-dive surface to the `/` modal. Same
// two-wave model — title/description hits come from the in-memory store, comment
// hits stream in from /api/search — but here results are filterable by the same
// dimensions as the board (status, product/arc/repo, tag, priority) and the
// query + filters live in the URL so a search is bookmarkable. The `/` modal's
// "Open the search page" link hands its text here via ?q=. An empty query is
// itself a valid search (PROG-78): browse mode — every issue passing the
// filters (all of them by default, so the page opens onto the full list),
// newest first. Long result sets paginate: issues/containers cap the DOM at
// PAGE rows per "Show more" click (the data is already in memory), and the
// comments section pulls further pages from the server via ?offset=. Issues
// render as a table whose column headers sort (asc → desc → back to the
// default relevance/recency order); the sort is a URL param like the filters.
// The filter row is the shared FilterBar (PROG-92) — same dropdowns, mobile
// disclosure, Clear, and sticky-restore behavior as the board; only `q` is
// volatile (filters + sort stick across visits, the query text doesn't).

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ISSUE_STATUSES } from "../../shared/constants";
import type { WireIssue, WorkspacePayload } from "../../shared/types";
import { FILTER_NONE, matchesNullableId, SEARCH_FILTERS_KEY } from "../boardFilters";
import FilterBar, { useStickyFilterUrl } from "../FilterBar";
import FilterSelect from "../FilterSelect";
import {
  browseIssues,
  containerLabel,
  highlight,
  ISSUE_SORT_KEYS,
  queryTerms,
  searchContainers,
  searchIssues,
  sortIssueHits,
  type IssueSort,
  type IssueSortKey,
  type Segment,
} from "../search";
import { PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import PriorityIndicator from "../PriorityIndicator";
import { issueKeyOf, useCommentSearch } from "../store";

// Rows rendered per section before a "Show more" click (PROG-78 pagination).
const PAGE = 50;

const FILTER_KEYS = ["initiative", "product", "repo", "arc", "tag", "priority", "status"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Partial<Record<FilterKey, string>>;

// `q` is content, not a selection — it never sticks (PROG-92). Module-level so
// the sticky effect's dependency stays reference-stable.
const VOLATILE_KEYS = ["q"] as const;

// The issue table's columns (PROG-78): one per displayed dimension, each
// header click-sortable. Order here is the column order.
const COLUMNS: { key: IssueSortKey; label: string }[] = [
  { key: "key", label: "Key" },
  { key: "title", label: "Title" },
  { key: "product", label: "Product" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
];

function parseFilters(search: string): { q: string; filters: Filters; sort: IssueSort | null } {
  const params = new URLSearchParams(search);
  const filters: Filters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  // Sort lives in the URL like the filters, so a sorted view is bookmarkable.
  // Unknown sort keys are ignored (malformed bookmark → default order).
  const sortKey = params.get("sort") as IssueSortKey | null;
  const sort: IssueSort | null =
    sortKey && ISSUE_SORT_KEYS.includes(sortKey)
      ? { key: sortKey, dir: params.get("dir") === "desc" ? "desc" : "asc" }
      : null;
  return { q: params.get("q") ?? "", filters, sort };
}

export default function Search({ workspace }: { workspace: WorkspacePayload }) {
  // URL plumbing + sticky filters + ancestor pruning, shared with the board
  // (PROG-92, FilterBar.tsx). `q` is volatile: the filters and sort stick
  // across visits, the query text doesn't.
  const { search, navigate, setParam } = useStickyFilterUrl({
    workspace,
    basePath: "/search",
    storageKey: SEARCH_FILTERS_KEY,
    volatileKeys: VOLATILE_KEYS,
  });
  const { q, filters, sort } = useMemo(() => parseFilters(search), [search]);
  const terms = useMemo(() => queryTerms(q), [q]);

  // Column-header click: new column → ascending, same column → flip, third
  // click → back to the default order (relevance for a query, recency for
  // browse). The default is a real state, not just "asc on something", so it
  // stays reachable.
  const cycleSort = (key: IssueSortKey) => {
    const params = new URLSearchParams(search);
    if (sort?.key !== key) {
      params.set("sort", key);
      params.delete("dir");
    } else if (sort.dir === "asc") {
      params.set("dir", "desc");
    } else {
      params.delete("sort");
      params.delete("dir");
    }
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

  // Comment hits arrive as issue ids; a Map resolves them without a per-hit
  // linear scan over the (up to 5k-issue) workspace.
  const issueById = useMemo(
    () => new Map(workspace.issues.map((i) => [i.id, i])),
    [workspace.issues],
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

  const filtersActive = FILTER_KEYS.some((k) => filters[k]);
  // Empty query = browse mode (PROG-78): the filters — even none, the default
  // view — are the whole search, so every issue passing them shows, newest
  // first. Only issues can browse; containers and comments need a term to match.
  const browsing = terms.length === 0;

  const issueHits = useMemo(() => {
    const base =
      terms.length === 0
        ? browseIssues(workspace).filter((h) => passes(h.issue))
        : searchIssues(workspace, q, 0).filter((h) => passes(h.issue));
    return sortIssueHits(workspace, base, sort);
  }, [workspace, q, terms, passes, sort]);
  const containerHits = useMemo(() => searchContainers(workspace, q, 0), [workspace, q]);

  // Pagination (PROG-78): the full hit lists stay in memory (instant); only the
  // DOM is capped, at PAGE rows per "Show more" click. Limits reset whenever
  // the query, filters, or sort change — `search` is the canonical state for
  // all three. Reset during render (prev-value pattern) rather than in an
  // effect, so a changed result set never paints a frame at the old depth.
  const [issueLimit, setIssueLimit] = useState(PAGE);
  const [containerLimit, setContainerLimit] = useState(PAGE);
  const [prevSearch, setPrevSearch] = useState(search);
  if (search !== prevSearch) {
    setPrevSearch(search);
    setIssueLimit(PAGE);
    setContainerLimit(PAGE);
  }

  const { data: comments, isFetching, hasMore, fetchMore, isFetchingMore } = useCommentSearch(q);
  // Resolve comment hits to issues and apply the same filters.
  const commentHits = useMemo(() => {
    return (comments?.hits ?? [])
      .map((hit) => {
        const issue = issueById.get(hit.issueId);
        return issue ? { ...hit, issue } : null;
      })
      .filter((h): h is NonNullable<typeof h> => h !== null && passes(h.issue));
  }, [comments, issueById, passes]);

  return (
    // Full app-shell width (PROG-92) — matching the board so the filter row
    // fits on one line on desktop; <main> caps it at max-w-screen-2xl.
    <div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setParam("q", e.target.value || null)}
        placeholder="Search issues, descriptions, comments…"
        className="w-full rounded-lg border border-line bg-card px-4 py-3 text-sm focus:border-ink-faint focus:outline-none"
      />

      {/* The shared filter bar (PROG-92): identical dropdowns, mobile
          disclosure, and Clear to the board's. Status is search-specific (the
          board's columns ARE the statuses), so it rides in the `before` slot.
          Clearing keeps the query and the sort — they're not filters. */}
      <FilterBar
        workspace={workspace}
        filters={filters}
        setParam={setParam}
        activeCount={FILTER_KEYS.filter((k) => filters[k]).length}
        clearVisible={filtersActive}
        onClear={() => {
          const params = new URLSearchParams(search);
          for (const key of FILTER_KEYS) params.delete(key);
          const qs = params.toString();
          navigate(qs ? `/search?${qs}` : "/search", { replace: true });
        }}
        before={
          <FilterSelect
            label="Status"
            value={filters.status}
            options={ISSUE_STATUSES.map((s) => [s, STATUS_LABELS[s]])}
            onChange={(v) => setParam("status", v)}
          />
        }
      />

      <div className="mt-6 space-y-6">
        {containerHits.length > 0 && (
          <Section title="Containers" count={containerHits.length}>
            {containerHits.slice(0, containerLimit).map((hit) => (
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
            {containerHits.length > containerLimit && (
              <ShowMore onClick={() => setContainerLimit((n) => n + PAGE)}>
                Show {Math.min(PAGE, containerHits.length - containerLimit)} more ·{" "}
                {(containerHits.length - containerLimit).toLocaleString()} remaining
              </ShowMore>
            )}
          </Section>
        )}

        <Section title="Issues" count={issueHits.length}>
          {issueHits.length === 0 ? (
            <Empty>No issues match.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        aria-sort={
                          sort?.key === col.key
                            ? sort.dir === "asc"
                              ? "ascending"
                              : "descending"
                            : undefined
                        }
                        className="px-3 py-2 text-left"
                      >
                        <button
                          onClick={() => cycleSort(col.key)}
                          className={`flex items-center gap-1 text-xs font-medium uppercase tracking-wide hover:text-ink-soft ${
                            sort?.key === col.key ? "text-ink-soft" : "text-ink-faint"
                          }`}
                        >
                          {col.label}
                          {sort?.key === col.key && (
                            <span aria-hidden>{sort.dir === "asc" ? "▲" : "▼"}</span>
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {issueHits.slice(0, issueLimit).map((hit) => {
                    const key = issueKeyOf(workspace, hit.issue);
                    const product = productById.get(hit.issue.productId);
                    return (
                      // The whole row navigates (it's the click target the old
                      // card rows offered); the title stays a real link for
                      // middle-click / open-in-new-tab.
                      <tr
                        key={hit.issue.id}
                        onClick={() => navigate(`/issue/${key}`)}
                        className="cursor-pointer border-t border-line first:border-t-0 hover:bg-line/40"
                      >
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink-faint">
                          {key}
                        </td>
                        <td className="w-full min-w-56 px-3 py-2">
                          <Link
                            href={`/issue/${key}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            <Highlighted segments={highlight(hit.issue.title, terms)} />
                          </Link>
                          {!hit.inTitle && hit.issue.description && (
                            <p className="mt-0.5 truncate text-xs text-ink-soft">
                              <Highlighted
                                segments={highlight(descSnippet(hit.issue.description, terms), terms)}
                              />
                            </p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint">
                          {product?.name}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint">
                          {STATUS_LABELS[hit.issue.status]}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint">
                          {hit.issue.priority !== "none" ? (
                            <span className="flex items-center gap-1.5">
                              <PriorityIndicator priority={hit.issue.priority} />
                              {PRIORITY_LABELS[hit.issue.priority]}
                            </span>
                          ) : (
                            <span aria-label={PRIORITY_LABELS.none}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {issueHits.length > issueLimit && (
            <ShowMore onClick={() => setIssueLimit((n) => n + PAGE)}>
              Show {Math.min(PAGE, issueHits.length - issueLimit)} more ·{" "}
              {(issueHits.length - issueLimit).toLocaleString()} remaining
            </ShowMore>
          )}
        </Section>

        {/* Comment search needs a term (the server LIKE has nothing to match
            in browse mode), so the section disappears rather than sitting at
            a misleading zero. */}
        {!browsing && (
          <Section
            title="Comments"
            count={commentHits.length}
            countIsPartial={hasMore}
            loading={isFetching}
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
            {hasMore && (
              <ShowMore onClick={() => fetchMore()}>
                {isFetchingMore ? "Loading more matches…" : "Show more matches"}
              </ShowMore>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

// The per-section pagination control (PROG-78): dashed like Empty so it reads
// as "the list continues", not another result row.
function ShowMore({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-md border border-dashed border-line px-3 py-2 text-xs text-ink-faint hover:border-ink-faint hover:text-ink-soft"
    >
      {children}
    </button>
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
  countIsPartial,
  loading,
  children,
}: {
  title: string;
  count: number;
  // True while more matches exist server-side than are loaded (comments), so
  // the header reads "50+" instead of implying 50 is the total.
  countIsPartial?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
        {title} · {count}
        {countIsPartial && "+"}
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
