### PROG-158 — Inline due-date picker on the outline row

**Context.** The outline row already carried the two shared editable indicator
glyphs — `PriorityPicker` (PROG-136) and `StatusIndicator`/`StatusPicker`
(PROG-140) — so priority and status are settable in place from any outline.
The due date was the odd one out: editable on the action page, the new-action
dialog, the palette `D` picker and Agenda rows, but not from the outline, where
most capture and triage happens. PROG-158 closes that gap.

**Decision.** A new `DuePicker` (src/client/DuePicker.tsx) renders in the row's
right-aligned glyph cluster, ordered **due · priority · status** (status stays
outermost so the right edge is flush; the calendar sits just inside priority).
It mirrors `PriorityPicker`'s in-place idiom — a native control stretched
invisibly over the glyph — with one difference forced by the platform: a
`<select>` pops on a bare click, but `<input type="date">` does not, so the
transparent overlay calls `showPicker()` on click (falling back to focus on the
older Safari that lacks it, the same fallback `IconDateInput` uses). Writes go
through the optimistic `updateAction({ dueDate })`, so the row re-renders
instantly.

**Presentation.** A set date shows its `formatDueDate` short label beside the
calendar and turns overdue-red once past today (`dayDiff` vs `todayISO`); a
`muted` prop suppresses that red on done rows, which already read as finished.
An unset due date is glyph-only and — like `none` priority — hidden until row
hover/focus while staying hit-testable, so undated rows read as nothing at a
glance but a tap still lands.

**Also.** The calendar SVG was a private `CalendarGlyph` inside `fields.tsx`;
it moved to the shared `glyphs.tsx` so the sidebar date field and the outline
picker draw one shape. No API, schema, or wire-type change — `dueDate` already
existed (D37).
