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
