### PROG-101 — sidebar field glyphs on the action page

The owner's mockup shows each sidebar field with a small glyph in a left
gutter, the way Priority already had its signal bars. Decisions:

- **Status gets a circle-progression indicator** (`StatusIndicator`, a
  sibling of `PriorityIndicator`: 16×16 SVG, shape + color both carry the
  meaning, aria/title on the glyph). Backlog = dashed outline, todo = solid
  outline, in progress = half pie, in review = three-quarter pie, done =
  filled disc + check, canceled = faint disc + ✕. Colors follow the palette's
  documented semantic roles — `--adobe` (active/"now") for the two in-flight
  states, `--moss` (completed) for done, the faint ink track for
  not-started/canceled — rather than stock red/yellow/green.
- **Estimate gets a fill gauge** (`EstimateIndicator`): a rounded square that
  fills bottom-up in proportion to the estimate's position on the fixed
  0–8 scale. Neutral ink tone — unlike status/priority, size has no urgency
  semantics for color to encode. Unset renders the outline dashed (the
  app-wide "not set" treatment); 0 points is a valid empty gauge.
- **The due-date calendar button moved into the gutter.** The native
  right-edge picker indicator hides; a gutter button (same 16×16 box, so the
  icon column aligns) calls `showPicker()`, falling back to focusing the
  input where that API is missing (older Safari). The input itself stays a
  native `type=date` — all the iOS width workarounds from D37 remain.
- **Field order is now Status · Due date · Priority · Estimate** (due date
  moved above priority, per the action). Container/arc/tags/work-on follow
  unchanged.

### PROG-101b — every gutter glyph is a picker button

Owner follow-up: since the calendar glyph is actionable, the other glyphs
should be too. Each status/priority/estimate glyph is now a button that pops
its select's dropdown via `HTMLSelectElement.showPicker()` — the only script
API that opens a native select — falling back to focusing the select where
the API is missing (Space/Enter then opens it). The wiring lives in one
`IconSelect` wrapper (glyph button + `FieldSelect` sharing a ref), so a
future fifth field can't forget it; all four buttons share a hover-wash
class and a slightly padded hit target.
