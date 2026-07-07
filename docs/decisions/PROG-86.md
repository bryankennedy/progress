### PROG-86 — drag-to-reorder in the Outline via the shared board rank

The Outline already sorted each sibling group by the fractional-index `rank`
(PROG-43) the board uses to order a status column. So making rows drag-reorderable
needed **no backend change**: a drop computes a new key strictly between the two
neighbours (`rankForReorder` / `rankBetween`) and fires one optimistic
`updateIssue({ rank })` — the same write the board makes. Because the key is
shared, a drag in the Outline moves the card on the board and vice-versa, which
is exactly what the issue asked for. *Decisions within:* (1) **Reorder within a
sibling group only** — a drop onto a row under a different parent/arc is a no-op;
reparenting stays on Tab/Shift+Tab, matching the board's rank-only semantics
("move up or down in the rank"). Drag-to-reparent was considered and deferred as
a separate, larger interaction. (2) **Dedicated grip handle**, not whole-row
drag — the row holds an editable title input, so a `setActivatorNodeRef` grip in
the left gutter starts drags while taps/typing on the input and the ⋯ open-link
keep working. (3) **The whole subtree is the sortable block** — dragging a parent
carries its children visually; each sibling group is its own `SortableContext`,
one `DndContext` per product. (4) **PointerSensor (distance 4) + KeyboardSensor**
— one pointer path covers mouse and touch from the grip (`touch-none` so a grip
drag reorders instead of scrolling), and the focused handle is arrow-key
reorderable for accessibility. Math is unit-tested (`outlineReorder.test.ts`);
the drag wiring verified in a browser (drag persisted across reload).
