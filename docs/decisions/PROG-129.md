### PROG-129 — Drops heal tied ranks instead of assuming distinctness; appends step +1

**Context.** Dragging an action to the bottom of a long arc page threw
`rankBetween: "zzz…s" does not sort before "zzz…s"` out of dnd-kit's drag-end
batch and unmounted the whole page (React #185 cascade — blank screen).
Production data showed two independent rots behind it:

1. **Duplicate keys.** `POST /api/actions` computes `rankAfter(global max)`
   with a read-then-insert (no atomicity), and the client's optimistic create
   mirrors it, so two creates in quick succession mint the SAME rank (the
   owner's back-to-back quick-adds: "Bluetooth speaker"/"Headphones",
   "Reading glasses"/"Extra glasses"). `rankForReorder` assumed sibling ranks
   were pairwise distinct — a drop landing between a duplicate pair had no gap
   to mint into and threw.
2. **Degenerate key growth.** Every create appends after the **global** max
   (D44), and `rankBetween(a, null)` bisected toward the alphabet ceiling —
   reaching `z` in ~6 appends, then extending: one extra `z` per ~6 creates,
   anywhere in the system. Real keys had grown to 38-char `zzz…` walls.

**Decision.** Three coordinated changes, no schema or API change:

- **Tie-healing placement** (`src/client/rankPlacement.ts`): all drop
  placement (outline `rankForReorder`/`rankForInsert`, board drop in
  `Home.tsx`) goes through `placementRanks`, which mints one key on the fast
  path but, when the slot's neighbours don't strictly order, widens to the
  maximal tied run and re-spaces it strictly between its distinct outer
  bounds — a few extra one-row PATCHes, and the degenerate data heals itself
  on the drag that hits it. Duplicates are thereby **tolerated, not
  prevented**: fixing the create race server-side would need an atomicity D1
  doesn't offer cheaply (or a unique index existing prod data violates), and
  a healed tie is harmless in a single-user app.
- **Appends step +1, not midpoint** (`src/shared/rank.ts`): `rankBetween(a,
  null)` with a real predecessor now emits the smallest key above `a`
  (V→W→…→z→z1→…), growing one char per ~61 appends instead of ~6.
  Between-two-keys inserts still bisect, `rankBetween(null, null)` still
  equals `DEFAULT_RANK` (PROG-87 container ties depend on it).
- **Guarded drag-end** (`Outline.tsx`/`Home.tsx`): the drop handlers wrap
  their body in try/catch — any future rank-math failure degrades to a no-op
  drop (console error, board resets its preview) instead of an unmount.

`scripts/heal-ranks.ts` (dry-run by default, `--apply` to write) renumbers
every action to short evenly spaced keys **preserving the exact current
global order**, run once against prod to collapse the accumulated z-walls
and reset the global max; the client-side heal keeps things clean after.

**Alternatives rejected:** adopting the Figma-style integer-part fractional
indexing scheme (true O(log n) append growth) — a rewrite of the shared key
math and its invariants for a growth rate the +1 step already makes a
non-issue at this app's create volume; preventing duplicates with a unique
index + retry — migration fails on existing prod duplicates and adds a write
path for a case the heal makes benign.
