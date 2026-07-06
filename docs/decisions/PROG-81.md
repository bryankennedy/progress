### PROG-81 — mobile audit: filters collapse + 44px touch targets

An audit of the rendered phone experience (WebKit at 360/390/430/768, touch
emulation, per the `mobile-first-audit` skill) found the app broadly solid —
correct `viewport-fit=cover` meta, zoom enabled, 19 px body, `pb-24` clearing
the bottom tab bar, no page-level horizontal overflow — but three things worth
fixing:

1. **Board filters buried the board.** The six filter dropdowns + New-issue +
   two toggles filled the entire first viewport; the cards (the point of the
   page) only appeared after scrolling past all of it. Fixed by collapsing the
   filter row behind a **"Filters"** disclosure on phones (`< sm`), collapsed by
   default with an active-count badge; at `sm`+ the row stays inline and desktop
   is byte-identical. *Hard call:* a phone user now taps once to filter, but
   gets three cards above the fold instead of zero — mobile is primary, so the
   board wins the default view.
2. **Sub-44 px touch targets.** The header New button (~34), avatar (32) and its
   dropdown rows (~31), the board's New-issue and Show-backlog/sub-issues
   buttons (~31), and the issue page's field-edit links — Move…/Change…/Edit…/
   Copy… — at ~19 px (on a phone the *only* way to fire those, since the
   keyboard shortcuts don't exist there). All bumped to a **≥44 px** row on
   mobile via `min-h-11` (and a `flex` row for the issue links so they keep
   their own line), reverting to the compact sizing at `sm`+.

*Deliberately deferred* (noted, not fixed, to keep the PR focused): tablet-range
(640–767 px) filter `<select>`s render at 14.4 px and can trigger iOS
zoom-on-focus — the global 16 px rule stops at 639 px; the bottom-tab-bar's
translucency lets card content bleed through faintly on scroll. Both are low
severity. Verified before/after in WebKit: board mobile small-targets 6→1, issue
12→5, desktop unchanged (Filters toggle hidden, six selects inline).
