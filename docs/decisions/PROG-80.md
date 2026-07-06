### PROG-80 — Outline: jump-to-issue moved to a persistent far-left gutter

On a phone there was **no way to reach an issue's page from the Outline** — the
only door was the trailing `…` link, which lived in an `opacity-0
group-hover:opacity-100` cluster on the right edge. Touch has no hover, so it
never appeared; even on desktop it sat at a right edge that shifts with the
row's text width. Fixed by relocating that same jump control to a fixed gutter
at the **far left** of every row (the issue asked for exactly this), so it's in
one predictable spot at every depth and reachable by tap.

- **Always visible on mobile, faint-until-hover on desktop.** The control is a
  per-row `<Link>` (an `<a>`, so it drag-selects/opens-in-new-tab like any link)
  rendered as a 24×24 tap target holding a three-dot glyph. Base opacity is full
  (mobile is primary); desktop dials it back with `sm:opacity-40` and firms to
  `opacity-100` on `sm:group-hover`/`group-focus-within`/`focus-visible`. So the
  outline stays calm on a wide screen but the affordance is discoverable — a
  strict improvement over the old fully-hidden state, which is the "improve
  desktop too" half of the ask.
- **Three dots rendered as an SVG, not the `…` text glyph.** A centered SVG
  gives a reliable square hit-area and crisp centering the text ellipsis
  (baseline-aligned) couldn't; the meaning is unchanged from the control it
  replaces.
- **Arc assignment stays a desktop hover affordance.** Only the *navigation*
  control moved to the always-on gutter; the `ArcMenu` (depth-0 only) remains in
  the right-side hover cluster. It was already hover-only and thus mobile-
  unreachable before this change — no regression, and arc assignment is reachable
  from the full issue page. Out of scope here.
- **Capture rows get a matching empty gutter** (`h-6 w-6` spacer) so the `＋`
  new-bullet and the product-capture row keep their bullets aligned with the
  issue bullets now pushed right by the open-link. *Not adopted:* making the
  bullet icon itself the link (Workflowy-style) — two adjacent controls to the
  same page reads as redundant and risks mis-taps while editing the title.
