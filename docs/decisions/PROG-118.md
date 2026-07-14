### PROG-118 — Outline drag moves actions between arcs and focuses

PROG-86 shipped drag-to-reorder but deliberately made a drop outside the row's
own sibling group a **no-op**, deferring drag-to-reparent as "a separate,
larger interaction". PROG-118 is that interaction: on the Outline, dragging an
action and releasing it in another arc, at the loose level, in another step
group, or in another focus's section now **moves** it there. *Decisions
within:*

1. **One page-wide `DndContext`** replaces the nested per-focus contexts (and
   the workspace-scope outer context for focus sections). Nested contexts made
   cross-section drags structurally impossible — the inner context swallowed
   the drag before the outer one could see the target. A single context with
   one `onDragEnd` that branches on what was picked up (focus / arc / action)
   keeps the PROG-87 section-reorder semantics intact while letting action
   rows travel anywhere on the page.
2. **"It lands where you dropped it."** A drop onto a row in another group
   adopts that row's `(arcId, parentActionId)` and slots above/below it by the
   board's pointer-past-middle rule (`rankForInsert`); a drop onto an arc
   section (header or empty body) appends to that arc's top level; a drop onto
   a focus section lands loose. One rule, no modes.
3. **Same-focus moves are one optimistic `PATCH`** (`arcId` +
   `parentActionId` + `rank`) — the existing update path, no new endpoint.
   **Cross-focus drops reuse the real move** (`POST /api/actions/:id/move`:
   re-key, alias, steps detach — PROG-102/PROG-124), now with optional
   `arcId`/`rank` so the action lands in the arc and position it was released
   over instead of always loose-at-default. The arc must belong to the target
   focus (server-validated); both fields are optional so the palette's
   focus-only move is unchanged.
4. **Cross-focus drops land top-level.** A moved action can't keep or gain a
   parent across focuses (same-focus invariant), so a drop over a step slots
   relative to that step's top-level root ancestor. Cross-focus
   drag-to-reparent (into a specific step group) is out of scope.
5. **Cycle guard client-side.** A drop into the action's own subtree is
   refused before the write (`inSubtreeOf`) — the server would reject it
   anyway, but skipping the doomed request avoids optimistic-rollback churn.
6. **Arcs and focuses still only reorder.** "All actions should be draggable
   between Arcs and Focuses" — actions, not containers; an arc dropped outside
   its focus stays put.

Verified by unit tests (`rankForInsert`, `inSubtreeOf`, `moveAction`
optimistic/rollback with arc+rank) and two new Playwright specs
(`e2e/outline-move.spec.ts`: arc→arc drag, and a cross-focus drag asserting
re-key + alias). The pre-existing `e2e/outline-container-reorder.spec.ts` was
also repaired in passing — its selectors still targeted the pre-PROG-111 grip
buttons, so it had been red since the handle consolidation.

### PROG-118b — held rows float, foreign groups open a slot, drops settle

The first cut moved rows correctly but read as inert: the grabbed row only
translated in place, foreign groups never showed where it would land, and the
release popped. Owner feedback asked for the board's feel. *Decisions within:*

1. **DragOverlay for held rows** — the same floating-card pattern as board
   cards and the PROG-87 section previews: bullet + title (+ capped step
   subtree), slight rotation and shadow, width capped to `max-w-md` so a
   full-width row reads as a card in hand. The in-list source dims to a ghost
   but **keeps its sorting translate** (exactly `BoardCard`): an untransformed
   ghost fights the strategy's neighbour displacement and overlaps rows.
2. **Live cross-group preview** (`onDragOver`, the board's PROG-59 pattern):
   when the hovered target resolves to a different sibling group, the row is
   re-homed there in the rendered list (`previewedActions` patches the active
   row's `focusId`/`arcId`/`parentActionId`/`rank`), so the target group —
   across arcs and focuses — genuinely opens the landing slot. Within one
   group the preview stays out (dnd-kit's same-context transforms already
   animate the gap; re-rendering against them fights). The **drop commits the
   preview**, not a re-resolution of `over` — after a preview, `over` is
   usually the active row itself (the PROG-59 lesson); `over` only fine-tunes
   the position within the previewed group. Requires
   `MeasuringStrategy.Always` since the preview moves real layout mid-drag.
3. **Real drop animation** instead of `dropAnimation={null}`: the ~180ms
   default tween glides the overlay into the committed slot with the shadow
   easing off. The null was PROG-43's workaround for the tween flying to the
   *stale* slot; PROG-119's synchronous store notification means the
   destination row is already re-rendered when the tween measures it, so the
   workaround (kept on the board, which still has its local mirror) is
   unnecessary here. Verified frame-by-frame: the landed row is stationary at
   its final position from frame 0 after mouseup.
