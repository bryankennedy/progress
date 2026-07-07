### Mobile-first audit — phone form controls + issue-page field order

A rendered phone-viewport audit (360/390/430/768 + desktop regression, touch +
DPR emulation) of the highest-traffic views, following the bottom-tab-bar nav
(PROG-79). No blocking defects remained — no horizontal page scroll, correct
viewport meta, the new-issue modal fits at 360 px — but two systemic touch
problems and one layout-order problem surfaced and are fixed. (M/L findings —
small issue-page text-links, Structure `+add` buttons, keyboard-hint clutter —
are recorded in the audit report but deferred to keep this change tight.)

- **Form controls are sized for touch on phones, globally.** Every `text-xs`
  control (board/agenda/search filters, the new-issue dialog, the issue sidebar)
  rendered at 14.4 px, under the 16 px below which iOS Safari zooms-on-focus and
  stays zoomed; many were also ~36 px tall, under the 44 px touch floor. Fixed
  with one rule in `styles.css` — `@media (max-width:639px)` forcing
  `input/select/textarea` to `font-size:16px` and `min-height:44px` (checkboxes/
  radios excepted; `min-height` never shrinks a taller field like the comment
  box). *Decisions within:* (1) **a single global rule, not per-component** — it
  covers surfaces with bespoke `<select>` markup (Agenda, the dialog) that a
  shared-component fix would miss, and prevents future drift. (2) **Unlayered on
  purpose** — Tailwind's `text-xs` utility lives in a cascade layer, and
  unlayered rules beat any layer regardless of specificity, so the element
  selector wins without `!important`. (3) **Scoped to ≤639 px** (Tailwind's `sm`
  floor) so the dense desktop sizing is untouched — mobile is primary, desktop
  degrades to nothing here. Verified: zero sub-16 px and zero sub-44 px form
  controls at 360/390/430 across all audited views.
- **The issue page surfaces its action fields above the activity log on
  mobile.** The layout was `flex-col md:flex-row`, so on a phone the field
  `<aside>` (Status/Priority/Estimate/Due/Container/Arc/Tags/Work-on-this) stacked
  *after* the description **and** the full comments+activity timeline — on a
  heavily-edited issue you scrolled past dozens of activity rows to change
  status. Rebuilt as a CSS grid: mobile (single column) flows description →
  field strip → timeline by source order; desktop pins content to the left
  column across both rows and the fields to the right column via explicit
  `col-start`/`row-start`/`row-span`, leaving the desktop view byte-identical.
  *Rejected:* duplicating `<TimelineSection>` behind `hidden`/`md:hidden` (double
  mount) and flex `order` hacks (can't express the desktop "right column spans
  two left-stacked rows" cleanly).
