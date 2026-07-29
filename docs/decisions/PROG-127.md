### PROG-127 — Board ghost-card create buttons

**Decision.** Each board column ends with a dashed, card-shaped "+ New action"
button that opens the existing create-action dialog — no new inline-create
surface. The button passes only what the column knows (`status`) plus a `stay`
flag; the board's container context (workspace/focus/arc filters) flows in
through the dialog's existing route-derived defaults, so the ghost button and
the header "New action" button stay behaviorally identical apart from status
and post-create navigation.

**`stay` over a callback.** `CreateDefaults` gained `status?: ActionStatus`
and `stay?: boolean`. `stay: true` simply skips the dialog's post-create
`navigate(/action/<key>)`; the optimistic store write already puts the new
card on the board, ranked last in its column — i.e. directly above the ghost
button that created it, which doubles as the visual confirmation. A
success-callback API was rejected as more machinery for the same effect
through the controller's fire-and-forget channel.

**Placement.** The button is the last child of the column's card list (inside
`SortableContext`), not pinned to the stretched column's bottom edge — so it
hugs the last card on short columns instead of floating far below. It is
neither sortable nor droppable, so drag previews and drops ignore it.

**Workspace-only filter.** While here, the dialog's board-derived defaults
learned the workspace-only case: with just a workspace filter active, the
first unarchived focus in that workspace is preselected instead of the global
first focus, per the action's "same context settings as the current board".
