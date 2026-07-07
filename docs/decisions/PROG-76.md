### PROG-76 — a "none" option on the nullable board/search filters

The board and search filters could only match a specific value, so there was no
way to ask "which issues have no Arc?" (or no Repo, or no Tag). Each nullable
filter now offers a **"none"** option alongside its values.

- **Which filters get it.** Only the genuinely nullable dimensions: **Arc**,
  **Repo**, and **Tag** (an issue with zero tags). Product and Initiative are
  always set on an issue, so they don't. Priority already has a real `none`
  *value* (matched by plain equality) — that's a populated field, not an empty
  one, so it's left untouched.
- **A URL sentinel, not an id.** The option's value is `FILTER_NONE = "none"`
  (`src/client/boardFilters.ts`), a reserved query value (`?arc=none`). It can't
  collide with a real container id — those are always prefixed (`arc_…`,
  `repo_…`, `tag_…`) — and it survives `URLSearchParams` without %-encoding, so
  a "no arc" board stays bookmarkable and readable. Arc/Repo matching goes
  through `matchesNullableId(field, filter)`: the sentinel keeps issues whose
  field is `null`, anything else is id equality. Tag matching is the same idea
  against the issue's tag set (none ⇒ empty set).
- **Outside the hierarchy.** "No arc/repo" belongs to no Initiative/Product
  branch, so `pruneImpossibleFilters` (PROG-75) skips the sentinel: the option is
  always offered and never pruned when an ancestor changes. Picking
  "Product X + Arc: none" is a valid "issues in X with no arc" board.
- **One shared control.** The board's and search page's filter dropdown were
  byte-identical copies; this extracted them into `src/client/FilterSelect.tsx`
  with a `nullable` flag that adds the "none" option, so both surfaces stay in
  step.
