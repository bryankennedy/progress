### PROG-130 — search (two-wave instant + streamed comments)

Search over titles, descriptions, and comments, confirmed via `/interview-me`.
The decisions:

- **Title/description search is client-side; comments are server-side.** The
  workspace payload already holds every issue/container title + description
  (D20), so that half runs in memory and paints instantly — the hard instant-UI
  rule (SPEC §2.1) is preserved with no round-trip. Comments are the one
  searchable text *not* in the store (deliberately, D20 — unbounded growth), so
  they need a server query (`GET /api/search`). Results arrive in **two waves**:
  local hits immediately, comment hits a beat later in their own section, ranked
  below the local ones. The owner explicitly wanted comments included even in
  the quick modal, accepting the streamed second wave.
- **`LIKE`, not FTS5.** Matching is case-insensitive **substring** (the owner
  types the word they remember; fuzzy is out of the first cut). Substring is
  exactly SQLite `LIKE '%term%'`, whereas FTS5 is token/prefix-based and would
  *miss* a mid-word match like "ozzie" inside a longer token — so `LIKE` is both
  simpler (no virtual table, no sync triggers, no migration) and a better
  semantic fit. Wildcards in the query are escaped with an `ESCAPE '\'` clause so
  `100%` matches literally. A single owner over a bounded comment set makes the
  scan cheap; revisit only if it stops being so. Multi-word queries AND across
  whitespace terms; results cap at 50 with a `truncated` flag.
- **Ranking weights title over description.** A title hit outranks a
  description-only hit regardless of term count (weights 3 vs 1, +1 for a
  title-prefix match); ties break by recency. Comments always sort last by
  construction (separate section). Pure + unit-tested (`src/client/search.ts`,
  `src/worker/searchComments.ts`).
- **A separate `/` modal, not the ⌘K palette.** Despite the codebase's "exactly
  one keyboard-driven surface" value (CommandPalette header), search gets its own
  `/`-triggered modal — a search-focused result UI (weighted sections, comment
  snippets with highlighted matches, a streaming section) would have cluttered
  the command palette. The palette stays about commands + quick jump. The
  **`/search` page** is the deep dive: same results, filterable by the board
  dimensions, query + filters in the URL so a search is bookmarkable.
- **The streamed comments section shows a small spinner** while its request is
  in flight. This is a deliberate, narrow exception to the no-spinner rule: it's
  an inherent network search the owner opted into, and the *instant* (local) half
  never spins — only the comments sub-section indicates loading.

### PROG-130b — Swallow the post-drag ghost click instead of trusting per-handle guards

(The entry above predates the current PROG-130 action — "Outline reorder
navigates after drop" — and is kept per the collision rule; this one is that
action's decision.)

**Context.** On mobile, reordering a row on the Outline navigated to another
action after the drop. Mechanism: iOS Safari synthesizes a bare `click` at
the RELEASE point after a touch drag (the Outline's `PointerSensor` never
cancels `touchmove`, so Safari's simulated mouse events aren't suppressed —
unlike the board's `TouchSensor`, which is why the board doesn't exhibit
this). dnd-kit guards post-drag clicks with a document-capture
`stopPropagation` only — which silences every React handler, including the
handle's own moved-distance guard, but does NOT cancel the click's default
action, and every outline handle is a real `<a href>` (PROG-111): the
browser navigated natively to whatever link sat under the finger.

A same-group reorder was usually safe by accident — the dragged row itself
lands under the release point, and its handle still holds the drag's
pointerdown coordinates, so the distance guard fired. The reliably failing
shape is any drop where the release point and the landing spot differ (arc
section header appends the row at the arc's end; cross-group hops), leaving
an unrelated link under the finger.

**Decision.** Two layers, both in `Outline.tsx`:

1. **One-shot window-capture click swallower** armed on pointer drag
   end/cancel (`swallowNextClick`): window capture runs before dnd-kit's
   document capture, so it can `preventDefault` the ghost before native
   anchor navigation. Disarmed on first click or after 400ms — a human can't
   produce an intentional click that fast after a drop. Keyboard drags don't
   arm it (no click follows an Enter/Space drop, and it would eat the next
   real click).
2. **Handle hardening**: a pointer click (`detail > 0`) whose handle never
   saw the pointerdown is a mis-targeted ghost, never intent — suppressed.
   Keyboard activation (Enter, `detail === 0`) still navigates.

The e2e spec (`e2e/outline-ghost-click.spec.ts`) emulates iOS's bare
synthesized click at the release point after a header-append drop; it was
verified to fail (navigate) on pre-fix code.

**Alternatives rejected:** switching the Outline to `TouchSensor` (loses
pointer-event unification and re-opens the PROG-125 sensor tuning for a
side-effect fix); making handles non-anchors with programmatic navigation
(loses middle/cmd-click open-in-tab, PROG-111's point); a dnd-kit upgrade
(no released fix — its guard is stopPropagation-only by design).
