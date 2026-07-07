### PROG-77 — Outline: dim completed issues, sticky "Hide done" toggle

The Outline showed every issue with no signal for completion. Two changes, no
new nouns:

- **Completed issues stay visible but read as finished.** Done/canceled rows
  render dimmed (`text-ink-faint`) and struck through (`line-through`), reusing
  the same archived-row idiom from Structure/Archive. Completion is keyed off the
  shared `isOpenStatus` helper (constants.ts), so "completed" means done **or**
  canceled — not a new outline-only notion.
- **A page-level "Hide done" toggle removes them entirely.** When on, the forest
  is built from `issues.filter(isOpenStatus)` — a hidden parent never recurses,
  so its whole subtree drops with it (acceptable: hiding done hides finished
  branches). Capture/indent/outdent math still runs off the full `issues` list,
  so what's visible never changes nesting behavior.
- **The toggle is a sticky per-user preference.** Persisted to `localStorage`
  (`src/client/outlinePrefs.ts`, key `progress:outline-hide-done`) and re-seeded
  on mount, so it survives navigating away and back — mirroring the sticky
  board-filters pattern (D-PROG-58/boardFilters.ts) but simpler: a bare boolean,
  not URL-backed, because the outline scope (not this toggle) is what belongs in
  the URL. Single-user app, so one global key (no per-user namespacing), and
  every storage access fails soft.
