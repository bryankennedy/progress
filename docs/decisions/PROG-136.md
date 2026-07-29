### PROG-136 — outline rows adopt the shared PriorityPicker; "none" stays hover-revealed

**Date:** 2026-07-29 · **Status:** decided

The ask: set an action's priority from the lists reached via Structure →
Focus/Arc. Those pages already render the shared `ActionListView`
(PROG-126), and its **table** mode already had in-place priority via
`PriorityPicker` in the `ActionTable` cell (PROG-132) — the gap was
**outline** mode (the default), whose rows showed a read-only
`PriorityIndicator`. The fix is one substitution in the outline's
`ActionRow`: render `PriorityPicker` instead. Because `/outline` and every
container page share `OutlineView`, priority is now editable in place across
all of them with the identical control used by the table, Agenda rows, and
nothing new to learn — exactly the "consistent format and display mechanism"
the action asked for.

**The "none renders nothing" convention (PROG-124) is kept, not traded
away.** A none-priority row still shows no glyph at rest; the picker is
mounted but transparent, fading in on row hover / keyboard focus. Crucially
it stays hit-testable while transparent (opacity doesn't remove hit-testing),
so on touch — where hover doesn't exist — a tap where the glyph sits still
pops the native select. *Rejected:* always showing the hollow-ring glyph on
every none row (re-litigates PROG-124's deliberate visual quiet — a faint
glyph on every fresh capture is exactly what it avoided), and a row context
menu (a second interaction pattern where the shared picker already exists).
