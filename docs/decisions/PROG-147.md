### PROG-147 — Micro type on-system, self-hosted fonts, touch-floor fixes

**Status:** accepted (2026-08-04). Part of the v05.1.2 design-standardization
arc; implements findings S5, CR5, and N6 from the PROG-146 audit plus a
responsive sweep at 320/390px and desktop widths.

**Micro type (S5).** The root is scaled to 120% (`html { font-size: 120% }`),
so rem-based sizes ride the sizing system — but 19 arbitrary `text-[Npx]`
literals didn't. Two new tokens in `styles.css` `@theme` (mirrored into
`brand-assets/tokens.css`): `--text-2xs: 0.6rem` (≈11.5px effective) and
`--text-3xs: 0.55rem` (≈10.6px effective), each with a Tailwind-convention
`--text-*--line-height: calc(1 / size)` so both get the same 1rem line box as
`text-xs`. Mapping applied:

- `text-[10px]` ×9 → `text-3xs` (10 → ≈10.6px; MobileTabBar labels, tag chips,
  PR-state chips, table/group headers). The tab-bar labels stay ≥10px effective,
  now slightly larger — legibility direction is up, never down.
- `text-[11px]` ×7 → `text-2xs` (11 → ≈11.5px; Outline key prefixes, Diary
  meta, outline capture key field).
- `text-[13px]` ×1 → `text-xs` (Admin allowlist email cell). Call: 13px sat
  between `text-2xs` (11.5) and `text-xs` (14.4); the Admin table is a
  low-density, low-traffic surface, so it maps up to the nearest standard token
  rather than minting a third micro size. No new token for a single site.
- `text-[15px]` ×1 → `text-sm` (Diary AI entry body, 15 → 16.8px). It's body
  copy and keeps its `leading-relaxed`; reading size on the app's calmest page
  is the right direction.

The token line-height gives the former arbitraries a 1rem line box (they
inherited 1.5 before, ≈15px at 10px type) — single-line labels only, so the
~4px growth is invisible everywhere except the mobile tab bar, which gets
~4px taller (well inside the `pb-24` clearance and a net touch-target gain).

**Self-hosted fonts (CR5).** The Google Fonts CDN links (render-blocking
third-party CSS + FOUT on a PWA) are gone. `public/fonts/` now carries the
exact five woff2 **latin subsets** Google served: Spectral 400 (21.7KB),
500 (22.8KB), 600 (22.9KB), IBM Plex Mono 400 (14.7KB), 500 (14.9KB) — ~97KB
total, the same bytes browsers were fetching from gstatic. Subset choice:
only the weights the app uses (`font-medium`=500, `font-semibold`=600 +
regular; grep found one `italic` use, which was *already* synthesized — the
old CDN link never loaded italic faces — so italics are deliberately not
shipped). `@font-face` rules with `font-display: swap` and Google's latin
`unicode-range` live in `styles.css`; non-latin glyphs fall back to Georgia /
ui-monospace. `index.html` preloads the two workhorse files (Spectral 400,
Plex Mono 400) with `crossorigin` (font fetches are CORS-mode even
same-origin). Consequences:

- **CSP tightened** (`public/_headers` + REFERENCE §security-headers):
  `style-src` drops `fonts.googleapis.com`, `font-src` is now `'self' data:`.
- The Worker's **not-authorized page** (`src/worker/pages.ts`) switches to the
  same `/fonts/*` files — static assets are served outside the `/api` auth
  gate, so the unauthenticated page can load them.
- No service worker precaches assets (the PWA has only an install prompt), so
  there is no precache list to update.

**Touch floor (N6).** The board's empty-column drop target `min-h-8` (38px) →
`min-h-11` (44px), matching the touch floor everything else respects.

**Responsive sweep.** One real fix: `PageHeader`'s `actions` slot was a
non-wrapping `flex` — Outline's Hide-done + Scope cluster (a select as wide as
the longest workspace name) could overflow a 320px viewport. It now wraps
(`flex-wrap gap-x-4 gap-y-1 min-w-0`). Checked and fine: Header top bar
(mobile nav lives in the tab bar), FilterBar (flex-wrap + mobile disclosure +
the global ≤639px select `min-width:0`/`max-width:100%` rule), board columns
(`min-w-72` + `overflow-x-auto` + scroll snap), Agenda list/table (table wraps
in `overflow-x-auto`), all four modals (`inset-0 p-4` gutters + `max-w-lg/xl`
+ internal scroll), PageHeader meta lines (wrap as flex items). Desktop: no
route grew past its reasoned `max-w-*`; on the two `max-w-screen-2xl` pages
(Board, Search) the header carries no `actions`, so `ml-auto` stretches
nothing.
