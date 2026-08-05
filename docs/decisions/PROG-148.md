### PROG-148 — One page-header grammar across routes

**Status:** shipped (2026-08-04). Implements the positional-consistency slice
of the PROG-146 audit (findings S6, CR6, CR7, N1, N3, N4). Layout/markup only —
no data or behavior changes beyond what's recorded below.

**The canonical header.** A shared `PageHeader` component
(`src/client/PageHeader.tsx`) renders every route's opening row: an `<h1>` in
`text-2xl font-semibold` with **normal tracking** — `tracking-tight` was
dropped everywhere (CR6: it's a grotesque-sans convention; Spectral's fitted
sidebearings clot at 2xl), including the entity-title pages, SignIn, and the
header brand mark — plus three slots: `meta` (the small count line beside the
title), `actions` (a right-aligned control cluster), and `below` (a full-width
block under the title row). Adopted by Board, Search (both previously had **no
h1** — their heading order started at h2), Agenda, Diary, Outline, Archive, and
Admin. Per-page max-widths are untouched (the audit calls them reasoned).

- **Container/Action pages stay off the component.** Their header grammar is
  breadcrumb + inline-editable entity title — that title IS the h1. Forcing
  `PageHeader` there would break the InlineEdit wiring for no positional gain;
  they share the canonical h1 classes instead.
- **Board h1 supersedes PROG-53.** PROG-53 dropped the board's heading as
  redundant with the app name; the audit showed the cost (the most-visited page
  anchored on an h2 column label, and per-page drift). "Board" is now the h1,
  the count line rides in `meta`.

**Board's duplicate New button removed (CR7).** The board was the only page
with a second create entry point next to the global header's New menu. The
button is gone; the `C` shortcut is untouched (it lives in
`commands/useGlobalKeys.ts`, palette-driven, never button-driven — verified,
and no e2e spec clicked the button), the per-column ghost "+ New action" cards
stay, and the board's meta line now says "C for a new action" so the shortcut
stays discoverable.

**Agenda adopts the shared FilterBar (S6).** The hand-rolled three-select row
is gone; the Agenda now renders `FilterBar` via `useStickyFilterUrl`
(storage slot `progress:agenda-filters`, added in `boardFilters.ts`):

- **Param names:** the existing `focus` / `arc` / `tag` params already matched
  the shared names, so old bookmarks keep working; the page gained `workspace`
  and `priority` by adopting the shared five wholesale. No conflicts, nothing
  renamed.
- **New behavior gained:** mobile "Filters" disclosure, hierarchy narrowing +
  ancestor pruning (PROG-75), sticky restore on a bare `/agenda` (PROG-58
  pattern — the Agenda was previously never sticky), and the nullable **"none"**
  options on Arc/Tag (PROG-76) — the dated-set filter now uses
  `matchesNullableId` / the `FILTER_NONE` untagged check, mirroring the board.
  Quick-add ignores the "none" sentinels when inheriting filters (nothing to
  inherit; `inheritArcId` already rejects it, tags are guarded explicitly).
- The List/Table toggle is a view mode, not a filter — it moved to the
  header's `actions` slot rather than a FilterBar slot.

**Nits in the same pass:** section `<h2>`s on the search page gained the
`font-mono` the identical headings carry on the board and ActionListView (N3;
the board's non-page `<header>` is now the real page header). The one modal at
`mt-[8vh]` (CreateActionDialog) joined the other three at `mt-[12vh]`, its
`max-h` trimmed 84→80vh to keep clearing the viewport (N4). The `▾` text-glyph
chevrons (header New menu, FilterBar disclosure, outline ArcMenu) are now a
shared `ChevronDownGlyph` SVG in `src/client/glyphs.tsx` — currentColor, sized
to the glyph family, rotation preserved on the FilterBar disclosure (N1).
`ActionTable`'s `▲`/`▼` sort direction markers were left as-is: they're sort
indicators, not disclosure chevrons, and outside N1's list.
