### PROG-123 — move/arc pickers follow outline order and name the parent

The palette's move (focus) and arc pickers listed alphabetically per PROG-83's
"pickers list alphabetically" rule, with a generic "Focus" hint. That rule
predates the owner curating a manual order on the Outline/Structure pages; a
picker that ignores it fights the order the owner set, and a bare focus name
is ambiguous once the same name exists under two workspaces (e.g. "Admin").

Superseding PROG-83 **for these two pickers only**:

- **Move picker** — focuses group under their workspace in structure order
  (workspaces by `sortContainers`, focuses by `byRankThenName` within each),
  and the row hint is the parent **workspace name** instead of the constant
  "Focus". Since the workspace name is on screen, the filter query matches it
  too — typing a workspace name lists that workspace's focuses.
- **Arc picker** — arcs sort `byRankThenName` instead of alphabetically, and
  the hint names the parent **focus** (the level one up, per the action). All
  rows share it — an arc picker is scoped to the action's focus — but it
  confirms where the arc lives; "current" still wins on the current arc, and
  "No arc" stays pinned first.

Every other picker (tags, create dialogs, filter dropdowns, quick-jump) keeps
PROG-83's alphabetical order — nothing else displays rank, so alpha remains
the scannable choice there.

### PROG-123b — one Location field replaces the Focus + Arc pair

Owner review of PROG-123 (above) pushed further: flat lists with a
parent-name hint were still inconsistent with the app's nested-tree surfaces,
and two separate fields hid a real coupling — setting the focus limits the
available arcs, and a focus change silently clears the arc. Settled:

- **The field is "Location"** (owner-picked over Place/Nest/Context): the
  action's whole outline position, Workspace → Focus → Arc. The action page
  shows one Location field — focus line (gitUrl beneath), arc nested with an
  indent — replacing the separate Focus and Arc fields, so the clearing
  coupling is explicit instead of a surprise.
- **One palette picker renders the whole tree** in outline rank order:
  workspace rows are greyed, **inert headers** (keyboard selection skips
  them; supersedes PROG-123's hint-on-the-right presentation), focuses indent
  beneath, arcs beneath those. Picking a focus = "this focus, no arc" — the
  old pinned "No arc" row is gone — and picking an arc lands focus + arc in
  one step: same-focus picks are a plain `arcId` update, cross-focus picks
  ride `moveAction`, which already carries a landing `arcId` (PROG-118). The
  current location hints "current" and stays offered (moving within the
  focus, or up to "just the focus", is legitimate).
- **Filtering is tree-aware**: a query matches a row or any ancestor; an
  ancestor match keeps its subtree, and a match keeps its ancestors visible
  as context.
- **The shortcut is `L`** (owner-picked): M (move) and A (arc) are retired
  outright rather than aliased — one field, one key; D25's keyboard map
  amended in REFERENCE.

Scope: action page + palette only. The create-action dialog keeps its
separate focus/arc selects (and board filters their separate dropdowns — they
filter rather than set) for a follow-up under the consistency arc.
