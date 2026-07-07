### PROG-130 — search (two-wave instant + streamed comments)

Search over titles, descriptions, and comments, confirmed via `/interview-me`.
The decisions:

- **Title/description search is client-side; comments are server-side.** The
  workspace payload already holds every issue/container title + description
  (D20), so that half runs in memory and paints instantly — the hard instant-UI
  rule (SPEC §2.1) is preserved with no round-trip. Comments are the one
  searchable text *not* in the store (deliberately, D20 — unbounded growth), so
  they need a server query (`GET /api/search`). Results arrive in **two waves**:
  local hits immediately, comment hits a beat later in their own section, ranked
  below the local ones. The owner explicitly wanted comments included even in
  the quick modal, accepting the streamed second wave.
- **`LIKE`, not FTS5.** Matching is case-insensitive **substring** (the owner
  types the word they remember; fuzzy is out of the first cut). Substring is
  exactly SQLite `LIKE '%term%'`, whereas FTS5 is token/prefix-based and would
  *miss* a mid-word match like "ozzie" inside a longer token — so `LIKE` is both
  simpler (no virtual table, no sync triggers, no migration) and a better
  semantic fit. Wildcards in the query are escaped with an `ESCAPE '\'` clause so
  `100%` matches literally. A single owner over a bounded comment set makes the
  scan cheap; revisit only if it stops being so. Multi-word queries AND across
  whitespace terms; results cap at 50 with a `truncated` flag.
- **Ranking weights title over description.** A title hit outranks a
  description-only hit regardless of term count (weights 3 vs 1, +1 for a
  title-prefix match); ties break by recency. Comments always sort last by
  construction (separate section). Pure + unit-tested (`src/client/search.ts`,
  `src/worker/searchComments.ts`).
- **A separate `/` modal, not the ⌘K palette.** Despite the codebase's "exactly
  one keyboard-driven surface" value (CommandPalette header), search gets its own
  `/`-triggered modal — a search-focused result UI (weighted sections, comment
  snippets with highlighted matches, a streaming section) would have cluttered
  the command palette. The palette stays about commands + quick jump. The
  **`/search` page** is the deep dive: same results, filterable by the board
  dimensions, query + filters in the URL so a search is bookmarkable.
- **The streamed comments section shows a small spinner** while its request is
  in flight. This is a deliberate, narrow exception to the no-spinner rule: it's
  an inherent network search the owner opted into, and the *instant* (local) half
  never spins — only the comments sub-section indicates loading.
