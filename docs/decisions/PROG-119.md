### PROG-119 — Synchronous store notification (kill the drag-drop snap-back flash)

**Context.** Dropping a dragged outline row showed a one-to-two-frame flash: the
row snapped back to its original slot, then jumped to where it was dropped.
Cause: dnd-kit clears its drag transforms synchronously inside the drop event,
but the store's new order arrived a frame or two later — React Query v5's
`notifyManager` defers all subscriber notification through `setTimeout(0)`
(`systemSetTimeoutZero`), so the browser paints the old order with the
transforms already cleared before the optimistic rank write reaches the
components. The board never showed this because PROG-59 keeps a local
`columns` state mirror updated synchronously in `onDragEnd`; the Outline
renders straight from the snapshot cache, so it ate the notification delay on
all three of its drag surfaces (action rows, arc sections, focus sections).

**Decision.** Set `notifyManager.setScheduler((cb) => cb())` once in
`store.ts`, making cache-write notifications synchronous (React Query v4's
behavior). React 18 auto-batching still coalesces the setStates from a
multi-write drop (a tied-group container renumber issues N `updateContainer`
calls) into one commit, and every cache write in the codebase lives in
store.ts's event/async mutation helpers — nothing writes during render, which
is the hazard a sync scheduler would otherwise expose.

**Alternative rejected:** board-style local order mirrors in the Outline.
Three surfaces × (state + reconcile effect) of code, and any future
cache-rendered drag surface would need the same dance; the scheduler fix makes
every optimistic write paint in the same frame as its event, which is what the
instant-UI requirement (SPEC §2.1) wants globally.

**Evidence.** Headless Playwright driver sampling rAF frames after mouseup:
before — new order first visible at frame 2 (the flash); after — frame 0, no
old-order reappearance, no >2px positional jump, order persists across reload.
