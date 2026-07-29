### PROG-132 — Inline priority editing via an invisible-native-select PriorityPicker

**Context.** The Agenda showed each action's priority (the D47 signal-bars
indicator) but changing it meant navigating to the action page — friction the
v04.3 consistency arc exists to remove. The ask was Agenda-specific, but the
Agenda's table mode renders through the shared `ActionTable` (PROG-126), so an
Agenda-only control would have forked the table's priority cell per surface —
exactly the drift the arc warns about.

**Decision.** One shared `PriorityPicker` (`src/client/PriorityPicker.tsx`):
the existing `PriorityIndicator` glyph with a native `<select>` stretched
invisibly (`absolute inset-0 opacity-0`) over it, optimistic `updateAction` on
change. No custom dropdown, no `showPicker()` — a covered native select opens
the platform's own picker on click and the wheel on touch, and stays
keyboard-reachable. The wrapper `stopPropagation`s clicks, so inside
`ActionTable`'s navigate-on-row-click rows a priority change never doubles as
navigation. Used in the Agenda's list rows (glyph-only) and in `ActionTable`'s
priority cell (`showLabel` — glyph + level text, "—" for none), which makes the
same affordance appear on search and container tables too. That widening is
deliberate: the cell is one component, so every tabular surface gains — and
can't regress out of — inline priority editing (the arc's componentize-for-
consistency mandate). The action-page sidebar keeps its `IconSelect` field —
it's a labeled form field, not a dense-row control, and its visible select is
right for that context.

**Alternatives rejected.** Reusing `IconSelect` in rows (full-width visible
select — far too heavy for a 14px glyph slot); a custom popover menu (new
surface to maintain, worse mobile ergonomics than the native wheel);
Agenda-only scope (forks the shared table cell per surface).
