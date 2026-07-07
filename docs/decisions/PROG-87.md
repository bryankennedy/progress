### PROG-87 — containers rank like issues, but default to a shared tie so alphabetical survives

Arcs, products, and initiatives get the same fractional-index `rank`
(`src/shared/rank.ts`) the issue board introduced in D43, so the Outline's arc
sections (within a product) and product sections (at initiative scope) are
drag-to-reorderable exactly like issue rows — grip handle, whole section as the
sortable block, one shared `DndContext` with the rows (the handler branches on
what's dragged). The order is **global** (a column on the row, not a per-user
preference), per the issue. *Decisions within:* (1) **No backfill, no
append-on-create — a shared default tie.** Unlike issues (migration 0005 seeded
a spaced sequence), every container starts at the midpoint key
`DEFAULT_RANK = 'V'` and clients sort `(rank, name)`, so a group nobody has
touched keeps reading alphabetically — the owner's stated default — and new
containers interleave alphabetically instead of appending. (2) **First drag in
a tied group renumbers the group** (`containerReorderRanks`,
`src/client/containerReorder.ts`): `rankBetween` needs strictly ordered
neighbours, which ties can't give, so the drop freezes the group's visual order
with a fresh chain — N small writes, once — after which ranks are distinct and
every later drag is the board's usual single write. Renumbering only the
touched group keeps the blast radius one product's arcs / one initiative's
products. (3) **Initiatives get the column but no drag surface yet** — the
Outline never lists initiatives as rows (they're the scope picker), so their
rank only orders pickers/Structure until some view grows an initiative list.
(4) **Repos stay rank-less** — nothing lists repos in a reorderable way.
(5) The Structure page and the Outline's scope dropdown adopt the same
`(rank, name)` order so "the" order is one global fact, not per-view. Math is
unit-tested (`containerReorder.test.ts`); the wiring has a real-browser e2e
spec (`e2e/outline-container-reorder.spec.ts`) covering the alphabetical
default, both drag surfaces, and reload persistence.

### PROG-87b — container drags adopt the board's DragOverlay; the scope picker goes sticky

Dogfooding the section drag surfaced that the in-place sortable transform reads
as dead: the grabbed section didn't visibly move until it displaced a
neighbour, and rows under the pointer kept hover-highlighting mid-drag. Fixed
by adopting the board's proven pattern (D43/PROG-40) instead of in-place
translation: a `DragOverlay dropAnimation={null}` carries a floating preview of
the held grouping from the first pixel — header + up to 6 rows + "… n more",
shadowed for depth, so a screen-tall section never becomes a screen-tall
cursor — while the in-list source dims to a ghost (`opacity-30`, no translate;
only neighbours slide) and everything under the drag goes `pointer-events-none`
so no other interaction can react until release. Separately, the Outline's
scope picker is now sticky the same way Hide done is (PROG-77): the resolved
scope mirrors to `localStorage` and a bare `/outline` reopens it, with URL
params still winning and stale ids validated against live data. Both covered in
`e2e/outline-container-reorder.spec.ts` (overlay presence mid-drag + clear on
drop; scope surviving a navigate-away-and-back).
