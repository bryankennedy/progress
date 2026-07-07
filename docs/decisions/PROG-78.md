### PROG-78 — an empty query with active filters is a valid search (browse mode)

The `/search` page treated an empty query as "nothing to show" — the filters
were dead until you typed. Now **empty query + at least one active filter runs
the search anyway**: every issue passing the filters, newest first, so the
filters alone can answer "show me all my urgent issues" without inventing a
throwaway term. *Decisions within:* (1) **Setting a filter IS the method** —
no extra "show all" button; picking any filter with the box empty enters browse
mode, and the empty-state hint advertises it ("Or skip the text: set a filter…").
(2) **Empty query + no filters keeps the hint**, not a dump of the whole
workspace — an unfiltered browse of everything is the Board/Outline's job, and
rendering ~5k rows (scale seed) as one flat list serves nobody. (3) **Issues
only in browse mode** — containers and comments need a term to match (the
comment search is a server `LIKE`; there is nothing to send), so those sections
disappear rather than sit at a misleading zero. (4) **Newest-first, zero-score
hits** via a pure `browseIssues()` in `src/client/search.ts` (unit-tested),
reusing the page's existing filter predicate and row rendering; `inTitle` is
set so no unmatched description snippet renders. URL stays the state
(`/search?status=todo` cold-loads into browse), so a filter-only view is
bookmarkable like any other search.

### PROG-78b — search opens onto everything: default browse + pagination

Owner feedback on the first PROG-78 cut: the page should show data by default,
not a hint. **Supersedes decision (2) of the PROG-78 entry** — an empty query
with *no* filters no longer shows the hint; it IS the default search, and
`/search` opens onto the full issue list under the default filter settings
(any status, any arc, …), newest first. What makes that viable at scale is
pagination, added in the same change. *Decisions within:* (1) **"Show more",
not numbered pages** — the full hit lists stay in the client store (instant-UI
rule, SPEC §2.1); only the DOM is capped, at 50 rows per click for the Issues
and Containers sections. The reveal count is ephemeral component state, not a
URL param: it's a reading position, not search state, so bookmarks stay
`q`+filters only and the limit resets whenever either changes. (2) **Comments
paginate server-side** — `GET /api/search` gains `?offset=` (offset-based is
fine: single owner, recency order, bounded comment set — same rationale as the
`LIKE` scan, D/PROG-130); the section header reads "50+" while more remain and
a "Show more matches" control fetches the next page. Malformed offsets clamp
to 0 (`parseOffset`, unit-tested). (3) **`useCommentSearch` became an infinite
query** that flattens its pages back to the pre-pagination `{ hits, truncated }`
shape, so the `/` modal — which only ever wants the first page and its
"more comment matches there" note — is untouched.

### PROG-78c — the search results are a sortable table

Third cut on PROG-78 (owner: "make the output more of a table view and
implement sorting… by each of the dimensions displayed"). The Issues section
became a real `<table>` — Key · Title · Product · Status · Priority, exactly
the dimensions the old card rows showed — with click-to-sort headers.
*Decisions within:* (1) **Sort cycles asc → desc → default** — the default
order (relevance for a query, recency for browse) is a real state a third
click restores, not just "asc on some column", so the ranked view is never
lost. (2) **Semantic sort orders, not alphabetical** — key sorts by product
prefix then issue *number* (PROG-2 before PROG-10), status by workflow order,
priority by urgency; title/product are case-insensitive locale compares; every
tie breaks by recency. Pure `sortIssueHits` in `src/client/search.ts`,
unit-tested. (3) **Sort lives in the URL** (`?sort=&dir=`) like the filters —
a sorted view is bookmarkable; unknown values are ignored so a malformed
bookmark degrades to the default order. Sorting therefore also resets the
"Show more" reveal (it keys off the URL), which is the right behavior — a
re-sort should show the top of the new order. (4) **Whole rows navigate**,
preserving the old card click target, while the title stays a real `<Link>`
for middle-click/new-tab; the table wraps in `overflow-x-auto` so narrow
viewports scroll the table, not the page (PROG-81's rule). Containers and
comments keep their list layout — they don't share the issue dimensions.
