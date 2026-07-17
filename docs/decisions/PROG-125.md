### PROG-125 — Outline drag performance: render isolation, not a library swap

**Context.** At ~130 rendered rows the outline's drag had a >1s pickup freeze
and mid-drag stalls. Profiling (357-row synthetic workspace, production build,
4× CPU throttle, headless Chromium) reproduced it: 614ms median pickup, 425ms
median stall per row crossed, 10.1s of main-thread long tasks per short drag
session — and a pathological multi-second freeze whenever the pointer neared a
viewport edge (31s worst case observed in dev mode).

**Diagnosis — mostly our code amplifying a real library cost.** dnd-kit's
context design re-renders *every* `useSortable`/`useDroppable` consumer on
every drag tick (each row the pointer crosses, every droppable re-measure —
`over`, rect maps, and sort metadata all live in React context). The outline
made each of those ticks expensive:

1. Nothing was memoized — every tick re-rendered every row's full subtree
   (title input, indicators, arc menu), and every capture keystroke passed a
   fresh `renderCapture` closure to every row.
2. `MeasuringStrategy.Always` re-measured all droppables (a
   `getBoundingClientRect` each) at mount and on idle re-renders; the default
   `WhileDragging` covers the mid-drag preview hops for free, because a hop
   remounts the moved subtree and swaps the affected groups' `items`, both of
   which already queue re-measures.
3. dnd-kit's default FLIP `animateLayoutChanges` re-measured every row of a
   group in per-row layout effects on each cross-group preview hop.
4. Default edge auto-scroll (acceleration 10, 5ms cadence) re-entered before
   each step's bookkeeping finished — the "gets stuck while I keep dragging"
   report is largely this.

**Decision.** Stay on dnd-kit; make its ticks cheap instead of replacing it:

- Memoize `FocusOutline` / `Forest` / `OutlineNode` / `ActionRow`; thread the
  row environment and the roving capture state through two contexts whose
  values are stable for the life of a drag (a capture keystroke now re-renders
  N trivial null slots, not N row subtrees).
- Identity-cache the sibling-group `items` arrays and each focus's slice of
  the visible-action list, so a preview hop re-renders only the source and
  target focus.
- Default (`WhileDragging`) measuring; `animateLayoutChanges: () => false`;
  `autoScroll={{ acceleration: 2 }}` (the board's PROG-79 setting).

**Result** (same harness, medians): pickup 614→478ms, per-crossing stall
425→324ms, initial render 1310→1101ms, long-task total 10.1→4.4s, edge-scroll
stalls 2.7s→0.9s with a 201ms worst task (vs seconds-long freezes). Dev-mode
numbers improve more (pickup 2.46→1.64s) since unmemoized dev renders were the
bulk of the cost there.

**Tradeoffs accepted.**

- Rows below a cross-group insertion point now snap to their new position
  instead of FLIP-gliding. The within-group slide (transform strategy) and the
  release drop tween are unchanged, so the drag still reads the same.
- Edge auto-scroll is deliberately slower — one screen ~per second, matching
  the board.

**The remaining floor is architectural, and we're not paying to remove it
yet.** dnd-kit re-runs all N sortable hooks per drag tick no matter how cheap
we make each one; drag cost scales with rendered row count. At the owner's
current scale (~130 rows per scope) the optimized page is comfortably
responsive; at 400+ rows ticks are ~100ms on a throttled machine and it will
degrade further as scopes grow. If the outline outgrows this, the next step is
a redesign, in order of preference: (a) one droppable per *sibling group* with
custom pointer-Y slot math and an insertion indicator (drops per-row sortables
entirely, but changes the rows-slide-apart feel and re-implements keyboard
drags), (b) row virtualization (fights the page-wide drag, capture roving, and
variable-height subtrees), or (c) a custom drag layer. Not worth the regression
risk to the battle-tested PROG-86/87/118 semantics today.

The local-dev `PERF drag test` workspace (3 focuses × 4 arcs, ~400 actions,
`PERF*` prefixes) was seeded for this benchmarking and left in place for
future perf work.
