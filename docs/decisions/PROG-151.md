### PROG-151 — Text sits on surfaces

**Status:** shipped (2026-08-05). Applies the owner's design critique — "no
text or UI elements floating on top of the background — too low contrast,
looks unpolished" — as a standing layout rule on top of the v05.1.2 design
system (porcelain palette + four theme presets, PROG-145/146/150, and the
`PageHeader` grammar, PROG-148).

**The standard.**

- The raw canvas (body background) may carry only **page chrome** — the
  `PageHeader` h1/meta line, `FilterBar` controls (themselves carded),
  breadcrumbs — and **surfaces** (cards, wells, board columns).
- All entity **content** — titles, descriptions, field rails, dates, tags,
  lists, tables, timelines, comments — sits on a `bg-card` surface. Two
  sanctioned shapes: a **content well** (detail views — one `rounded-lg
  border border-line bg-card p-4 sm:p-6` container) and **carded rows/tables**
  (lists — the Search per-row card idiom, or a table wrapped in a card
  surface).
- Inside a well, nested inset elements (pickers, recessed panels) use `paper`
  as the recess tint — the pattern PROG-145 already set (Admin's note input,
  `CreateActionDialog`'s inset panels). Controls that were `bg-card` on canvas
  keep working inside a well on judgment — their `border-line` still
  delineates them in most cases — but where a control would otherwise sit
  directly on a same-color well (no longer distinguishable from its
  background), it recesses to `bg-paper` instead.
- Theme textures (PROG-150c) live on canvas/chrome only; wells/cards carry no
  texture rule and stay clean automatically (verified below, not just
  assumed).
- Board, Search, and Outline were the endorsed references and are untouched by
  this pass.

**What changed, per route.**

- **Action page** (`src/client/pages/ActionPage.tsx`) — the breadcrumb is the
  only thing left on canvas; the title (`InlineEdit`), description
  (`EditableMarkdown`), field rail, and timeline all move into one content
  well (`mt-4 overflow-hidden rounded-lg border border-line bg-card p-4
  sm:p-6`), replacing the old bare `max-w-3xl` container. The responsive grid
  (mobile: description → fields → timeline; desktop: two-column,
  `md:grid-rows-[auto_1fr]`) is unchanged, just nested one level deeper —
  PROG-90's mobile-first ordering and the row-pinning fix are untouched.
  - **The field rail recesses as one `bg-paper` panel** (`rounded-lg bg-paper
    p-3`), rather than switching each individual `FieldSelect`/`IconDateInput`
    control to a different fill. This was the deliberate design: those
    controls (`src/client/fields.tsx`) are shared with `CreateActionDialog`,
    which already nests them inside `bg-paper` inset panels for the identical
    contrast reason — touching their own hardcoded `bg-card` would have broken
    that call site instead of fixing this one. Wrapping the whole aside in
    paper reuses the existing precedent with zero changes to the shared field
    primitives, and every select/input/link inside regains the card-vs-paper
    contrast it had when the rail sat on canvas.
  - **Judgment call — comment cards recess to `bg-paper`.** Comment cards,
    the Git section's PR/commit rows, and the comment composer textarea were
    all `bg-card` on canvas before this pass; nested in a `bg-card` well they
    were only a hairline `border-line` apart from the surface behind them
    (border-vs-card contrast is ~1.3:1, per the PROG-146 audit) — visually the
    whole timeline read as one undifferentiated block instead of a sequence of
    distinct entries. Recessed to `bg-paper`, each entry reads clearly against
    the well. `InlineEdit`'s editing input and `EditableMarkdown`'s textarea +
    hover-lift (`hover:bg-card` → `hover:bg-paper`) got the same treatment —
    both components are used only inside wells now (grepped: `ActionPage.tsx`
    and `ContainerPage.tsx`, the only two call sites for each), so the change
    is global and safe.
  - **Overflow/focus-ring check.** The well keeps the `overflow-hidden` that
    used to sit on the bare page container (a PROG-90 iOS backstop against the
    native date input's wide intrinsic width) — it just moved from the
    invisible wrapper onto the now-visible card, along with the aside's own
    pre-existing `overflow-hidden`. Measured the actual clearance rather than
    guessing: with the well's `p-4 sm:p-6` and the aside's `p-3`, the
    closest-to-the-edge focusable control (the due-date input) sits ~44px
    inside the well's right edge at 1400px wide — far more than the
    `:focus-visible` ring's 2px outline + 2px offset needs. No element uses a
    negative margin to bleed to the well's true edge, so nothing needed
    PROG-149's `-outline-offset-2` inset-ring trim (that pattern stays reserved
    for controls seated flush against a dialog frame, which is a tighter fit
    than a padded well).

- **Container pages** (`src/client/pages/ContainerPage.tsx`) — the header
  block (entity name `InlineEdit`, key prefix / git URL fields, description,
  and the child-container pill list — Focuses/Arcs) all move into one content
  well, mirroring the action page. `ActionListView` renders below, unchanged,
  as list chrome on canvas (see below). The Archive/Unarchive button and the
  child-container pills were `bg-card` on canvas; recessed to `bg-paper` since
  they now sit inside the `bg-card` well.
  - **Judgment call — the child-container pills moved inside the well.** The
    task brief named only "name, description, git chip, meta" for the well;
    the Focuses/Arcs pill list wasn't explicit. Treated it as entity content
    (it's the container's own structural meta — what it contains) rather than
    list chrome, so it moved in alongside the header. This keeps every piece
    of "about this container" in one place instead of splitting it across two
    surfaces.

- **`ActionListView` / `ActionTable`** (`src/client/ActionListView.tsx`,
  `src/client/ActionTable.tsx`) — **`ActionTable` already had its own card
  wrapper** (`overflow-x-auto rounded-md border border-line bg-card`, from
  PROG-126's extraction) before this pass, so Search's and the Agenda's table
  modes were already compliant with the standard — nothing to fix there. The
  actual gap was `ActionListView`'s table mode: a naked `bg-card` quick-search
  input sitting directly on canvas, above a separately-carded table, with a
  dashed-but-unfilled empty-state paragraph in between. Fixed by wrapping the
  input + (table or empty message) in one shared `rounded-lg border
  border-line bg-card overflow-hidden` well; the input recesses to `bg-paper`
  (now nested in a card); `ActionTable` gained a `bare` prop that drops its own
  border/bg/rounded when the caller already supplies one, so `ActionListView`
  doesn't nest two card borders. **Chose the table-wrap over converting rows
  to Search-style cards**, per the brief's instruction, since `ActionTable` is
  shared with Search, container pages, and the Agenda — rows staying tabular
  cells (not per-row cards) keeps all three callers' column layouts identical.
  `Search`/`Agenda` don't pass `bare`, so their existing look is byte-for-byte
  unchanged (verified: `bare` defaults to `false`).
  - **List chrome stays on canvas.** The "Actions · N" heading, `toolbarExtras`
    (Copy arc as prompt / Open on board links), the Hide-done checkbox, and
    the `ViewModeToggle` segmented control render above the new card, on
    canvas — this mirrors the Board's column-header treatment (also chrome on
    canvas) and doesn't look orphaned in the browser check, so it stayed as
    the brief allowed.

- **Agenda / Diary / Archive sweep** — audited each for naked-canvas content
  rather than assuming it needed the well treatment:
  - **Agenda** (`pages/Agenda.tsx`) — bucket rows in list mode were already a
    carded `<ul>` (`rounded-lg border border-line bg-card`); table mode
    already inherits `ActionTable`'s own card (see above). Only the page-wide
    "Nothing due…" message (rendered when `dated.length === 0`) was bare text
    on canvas — boxed it in the same dashed empty-state style Search already
    uses (`rounded-md border border-dashed border-line`).
  - **Diary** (`pages/Diary.tsx`) — the progress strip, the AI entry
    (`DiaryEntry`), the Completed/Started/Also-touched recap lists, and the
    day-events list were all already carded (PROG-113 built them that way from
    the start). Only the "quiet day" empty message needed the same dashed-box
    treatment. The day-nav row (‹ › + date input) stayed on canvas as chrome,
    mirroring `FilterBar`'s treatment of individually-carded controls.
  - **Archive** (`pages/Archive.tsx`) — the Workspace → Focus → Arc grouping
    sections were already carded (`rounded-lg border border-line bg-card
    p-4`). Only the "No archived arcs yet" empty message needed the dashed
    box.
  - **Admin** (`pages/Admin.tsx`) — already fully carded: the allowlist table
    has its own `rounded-lg border border-line bg-card` wrapper and its empty
    message already renders inside that card. The `AddForm` inputs stay on
    canvas as chrome (same call as Diary's day-nav / `FilterBar`'s controls).
    No changes needed.
  - **Home/Search/Outline** — endorsed references, confirmed untouched.

**Themes.** Verified all four presets (`localStorage progress:theme` =
porcelain/adobe/sanzo/mono) render the new wells correctly via a Playwright
screenshot pass, not just by inspecting CSS: `bg-card` is a themed token, so
the well and its `bg-paper` recesses retint automatically with no
component-level theme awareness needed. Confirmed visually that adobe's sand
canvas texture, mono's dither, and sanzo's washi grain all stop cleanly at the
well's edge — the well reads as a clean surface placed on the textured ground,
which is the effect PROG-150c's "cards stay clean" rule was designed for and
this pass doesn't touch.

**Verification.** `bun run format`, `bun run check`, `bun test src` (273
tests) all pass unchanged. e2e: `comment-draft agenda-quickadd board-filters`
— 10 passed, 3 failed on the **pre-existing** strict-mode "Comment"/"Comment &
close" button-name collision (fails identically on `main`, not introduced
here — the well restructure didn't change either button's accessible name).
`board-reorder` — 4 passed, 1 failed on the **pre-existing** "drop to TOP"
timeout (also fails on `main`). Also ran `container-status`,
`container-priority`, and the full `outline-*` suite (12 tests) as a sanity
check on `ActionListView`/`ContainerPage`'s structural changes — all passed.
Browser check (Playwright, `signInAsOwner`, desktop 1400px + mobile 390px,
plus the three non-default themes): action page, focus page, arc page,
workspace page, Agenda, and Diary all confirmed — content sits on wells,
nothing clips, spacing reads as deliberate rather than boxed-in.
