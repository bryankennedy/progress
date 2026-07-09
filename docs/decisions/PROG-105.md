### PROG-105 — Restore an explicit Focus/Arc change affordance

**Status:** accepted (2026-07-09).

**Context.** PROG-104 unified the Focus/Arc sidebar fields with the boxed fields
and moved editing onto the gutter glyph (a click opens the move/arc palette),
dropping the explicit "Move…/Change…" links. In use that proved too hidden — the
glyph doesn't read as "click to change," and Focus/Arc are modal-backed (they
open the command palette), not inline selects like Status/Priority/Estimate, so
they need a visible trigger.

**Decision.** Re-add a small **"Change… (M)"** under the Focus value and
**"Change… (A)"** under the Arc value — the adobe-accent link style already used
by the Tags field's "Edit… (T)", so the three modal-backed fields
(Focus/Arc/Tags) share one affordance and the inline-select fields keep theirs.
Everything else from PROG-104 stays: the field order, the gutter glyphs (still
clickable), the value text aligned to the boxed fields, the name linking to its
container page, and the Work-on-this panel. Net: the name navigates, the glyph or
the "Change…" link opens the palette — the "old modal" — to reassign.

Client-only (`src/client/pages/ActionPage.tsx`); no API/schema change. Follows
PROG-104 (docs/decisions/PROG-104.md).
