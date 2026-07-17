### PROG-126 — One action list: embed the real outline + the real search table, don't build lookalikes

**Context.** Arc/focus pages had their own bespoke action list (three-way sort
select + status filter), the Agenda its own row style, and the search page its
own table — three unrelated renderings of "a list of actions". PROG-126 asks
for one consistent component with an outline ⇄ table switch.

**Decision.** Consistency by **reusing the real views**, not by writing a
fourth rendering that approximates them:

- The outline page's guts were extracted as an exported `OutlineView`
  (`pages/Outline.tsx`) taking `{scope, hideDone}` — scope now includes
  **arc** (FocusOutline's `arcOnly` mode: just that arc's forest at depth 0,
  capture pinned inside the arc, no section chrome). `/outline` itself is now
  a thin shell (scope picker + focus capture) around the same component, so
  the embed *cannot* drift from the page.
- The search page's results table was extracted as `ActionTable`
  (`src/client/ActionTable.tsx`) — columns, header sort-cycling, whole-row
  navigation, highlight/snippet — with two extension points the Agenda needs
  (a `due` column, a `trailing` cell for bump-due + ✓ Done). Search renders
  the extracted component, so it can't drift either.
- `ActionListView` (`src/client/ActionListView.tsx`) composes the two behind
  a segmented Outline/Table toggle for the container pages; the Agenda uses
  the toggle + table directly (its "list" mode stays the existing bucket rows,
  and buckets/quick-adds persist in both modes, per the action's carve-out).

**Choices of note.**

- **Table default order is `rank`** (the outline/board manual order), per the
  action; a header click cycles asc → desc → back to rank. Sort and quick
  search are local component state on embeds (the search page keeps its
  URL-driven versions) — bookmarkable sort on container pages wasn't asked
  for and would collide with existing URL params.
- **Hide done/canceled** reuses the outline page's sticky PROG-77 preference
  (same localStorage key) rather than minting a per-page one: it's the same
  question ("show finished work?") and the answer should follow the owner
  across views. It applies in both modes.
- **View mode is sticky per surface** (`viewPrefs.ts`: `container`, `agenda`)
  — the Agenda can live as a table while arc pages stay outlines.
- The old container-page list (status filter + status/number/updated sort
  select + inline priority/status selects) is **replaced**, not kept as a
  third mode: its sorting lives on as table columns, its status filter's main
  use as the hide-done toggle, and its inline edits are one click away on the
  action page. The estimate chip has no table column yet — add one to
  `ActionTable` if it's missed.
- Workspace pages weren't named in the action but got the same component
  (outline at workspace scope already existed; the table keeps the Focus
  column there and drops it on focus/arc pages where it's constant).
