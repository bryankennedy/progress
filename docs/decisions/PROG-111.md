### PROG-111 — One outline handle: the level bullet is the grip and the open-link

**Date:** 2026-07-13

**Context.** Outline rows had accumulated three separate leading affordances:
a 6-dot drag grip (PROG-86/87), a `⋯` far-left link to the action page
(PROG-80), and a passive level bullet (`LevelIcon`). Section headers (arc,
focus) likewise carried a grip plus a bullet. Three icons per row is visual
noise against the outline's "calm capture" goal, and the split gestures were
arbitrary (why does one dot-cluster drag and the other navigate?).

**Decision.** Collapse all three into a single `Handle` per row/header: the
level glyph itself (focus square / arc layers / action ring / step dot) is the
one interactive element. Click or tap opens the item's page; press-and-drag
starts the sortable move. The glyph keeps encoding the hierarchy level, so the
handle also *identifies* the row kind — "make it action-y / arc-y / focus-y".

**How the two gestures share one element.** The dnd-kit `PointerSensor`
already requires 4px of travel before a drag activates, so a motionless
click/tap never drags. The inverse — a drag's trailing `click` event must not
navigate — is handled locally in `Handle`: it records the pointer-down
coordinates and suppresses navigation when the click's release point moved
more than 4px. No dnd state plumbing needed. The element is a real `<a>`
(middle/cmd-click open-in-tab keeps working; modifier clicks fall through to
the browser) with `draggable={false}` and `-webkit-touch-callout: none` so
native anchor drag/press behaviors can't hijack the sortable, and `touch-none`
so a touch drag reorders instead of scrolling (unchanged from the old grip).

**Keyboard split.** Enter on the focused handle activates the link
(navigate); **Space** hands off to dnd-kit's `KeyboardSensor` (pick up,
arrow-reorder, Enter/Space drops — the sensor preventDefaults its own keys, so
dropping doesn't also navigate). Previously Enter and Space both started a
keyboard drag; navigation had a separate tab stop. Net: one tab stop per row
instead of two, both capabilities kept.

**Consequences.** Rows lose ~44px of gutter (two 20/24px slots → one 24px
slot); capture rows' alignment spacers shrink to one `w-6` box. The handle is
always shown at full strength (it's the bullet — the old grip's
faint-until-hover treatment made sense only for a *supplementary* icon).
`SortableSection` now takes `kind`/`href` so section handles navigate to
`/arc/:id` / `/focus/:id`. The non-interactive `LevelIcon` remains for
drag-overlay previews and capture-row bullets.
