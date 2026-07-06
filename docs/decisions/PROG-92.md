### PROG-92 — one FilterBar for board and search: sticky, prunable, full-width

The board and the search page had drifted into near-identical filter rows —
six container/priority dropdowns, hierarchy narrowing, a Clear link, and (board
only) the mobile "Filters" disclosure — implemented twice. Both now render one
shared **`FilterBar`** (`src/client/FilterBar.tsx`) and drive their URL through
one **`useStickyFilterUrl`** hook, which bundles the three behaviors that used
to be board-only: sticky restore (PROG-58), ancestor pruning on every write
(PROG-75), and the mobile disclosure with an active-count badge (PROG-81).
*Decisions within:* (1) **Surface-specific pieces stay with the surface, as
slots** — search's Status dropdown renders `before` the shared six (the board
has no status filter; its columns *are* the statuses), the board's
backlog/sub-issues toggles render `after`, and each caller owns its own
"what survives a clear" rule (`onClear`): the board keeps its toggles, search
keeps the query and the sort. (2) **Search's stickiness treats `q` as
volatile** — filters and sort stick across visits (one storage slot per
surface: `progress:search-filters` beside the board's key), but the query text
never restores; it's content, not a selection. The board's restore semantics
carry over verbatim: a URL that already has params (bookmark, deep link, the
modal's `?q=` handoff) wins and is then mirrored back to storage. (3) **Search
gains the Initiative dropdown and PROG-75 pruning as a side effect of sharing**
— its filter model already supported both (`?initiative=` filtered, nothing
rendered it; stale children were never pruned); the shared bar closes both
gaps rather than special-casing them away. (4) **The search page goes
full-shell-width** (drops its `max-w-3xl` cap, inheriting `<main>`'s
`max-w-screen-2xl` like the board) so the now-seven-dropdown row fits on one
desktop line — the owner's explicit ask, and the results table breathes.
(5) The board's Clear now preserves *both* toggles (it previously dropped
`subissues` while keeping `backlog` — an inconsistency the shared
delete-the-filter-keys implementation removes). *Rejected:* folding Status
into the shared set behind a flag (one surface's exception isn't worth a
config axis when a slot expresses it); making sort sticky-exempt like `q`
(sort is a view preference, closer to the board's toggles than to typed
content).
