### PROG-75 — prevent impossible board filters

The board's filters form a hierarchy (Initiative → Product → Arc/Repo). Two gaps
let a user pick a combination that matches nothing: child dropdowns weren't fully
restricted by every ancestor, and changing an ancestor left stale child
selections in the URL. Both are now closed.

- **Dropdowns offer only reachable options.** Product was already limited to the
  chosen Initiative; Arc and Repo now also honour the Initiative (via their
  Product's `initiativeId`), not just the Product. So with only an Initiative
  set, the Arc/Repo lists already exclude containers from other Initiatives.
- **Changing an ancestor prunes stranded descendants in the same URL write.**
  A single pure helper, `pruneImpossibleFilters` (`src/client/boardFilters.ts`),
  runs inside `setParam`: pick a new Product and a now-foreign Arc/Repo is
  dropped; switch Initiative and a Product from elsewhere — plus its Arc/Repo —
  cascade away. Pruning the URL (the single source of truth) rather than just
  hiding options keeps the active selection and the offered options in sync, and
  keeps the result the same whether a filter changed via the dropdown or a deep
  link. Logic lives in the helper (unit-tested,
  `src/client/boardFilters.test.ts`) so the component stays declarative; this
  mirrors the existing split where pure filter logic is unit-tested and e2e
  covers browser-only behaviour (PROG-58).
- **Non-hierarchical filters (Tag, Priority) are untouched** — they're global
  vocabularies with no parent to constrain them.
