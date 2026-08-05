### PROG-146 — Design critique: adopt the "Riso ink on porcelain" guideline

**Status:** accepted (2026-08-04). Implemented across the v05.1.2 design
standardization arc (PROG-145 palette/surfaces, PROG-147 responsive,
PROG-148 positional consistency, PROG-149 usability/a11y).

**Context.** The owner asked for a design critique with one steering note: the
"Adobe & Moss" theme — warm tan neutrals (`#f5efe0` paper family) with a
terracotta primary — reads as the prevailing "humanist tech" house style (warm
paper + terracotta + serif) and needs to be distinguished, with tweaks, not a
refresh. A design-director audit of the full client (every color/type/radius/
shadow/motion literal, computed WCAG ratios for the actual fg/bg pairs) returned
**7/10 — "a well-built system wearing a borrowed coat"**: token discipline,
component sharing, z-index/breakpoint/type-scale hygiene, touch-target and
safe-area work are all genuinely tight; the failures are a contrast floor below
AA on the app's most-used text color, suppressed focus/dialog a11y on a
keyboard-first product, positional drift in page headers/filters, and the tan
monoculture itself. Full report: appendix below.

**Decision.** Adopt the audit's prescription — **"Riso ink on porcelain"** — as
the design guideline:

1. **Palette (PROG-145).** Keep the ink-on-paper architecture, Spectral + IBM
   Plex Mono, the two-accent semantic system, and the olive **moss** family (the
   most ownable color already present). Replace the tan neutral ramp with a
   porcelain ramp — cards go literally white (`#ffffff`), canvas a faint sage
   (`#f0f1ea`) — and replace terracotta with a printer's **ultramarine**
   (`#3d52c4`, deep `#2d3c96`, light `#8a97e0`, wash `#dde1f7`). Danger stays
   `#b23c28` (warm danger against a cool accent gains meaning). Priority ramp
   recalibrated to `#a85a20` / `#a37b16` / `#5a6796` (all ≥3.89:1 vs card).
   The token is renamed `adobe` → `accent` — the old name would lie about an
   ultramarine. Reference: risograph print (ultramarine + olive + paper white);
   no Linear-like uses it. Shelf life stated honestly in the report (~3–5 years
   of distinctness; the durable identity is the serif/mono/glyph system).
2. **Tag chips** become tinted washes (hue blended over card, darkened-hue
   text, hue-tinted border) instead of white-on-brand-hue fills — passes
   contrast at any hue and keeps the seven Mermaid-brand tag hues as tag
   identity without letting them shout over the UI.
3. **Surfaces standardized on dark text on white cards** (the PROG-145 brief,
   done literally), radius snapped to the token scale (`--radius` default 6px so
   bare `rounded` lands on-system), shadows tinted with ink instead of neutral
   black.
4. **Positional consistency (PROG-148):** one `PageHeader` grammar — every
   route opens with an `h1` (Board and Search currently start at `h2`), Agenda
   adopts the shared `FilterBar`, the Board loses its duplicate New button.
5. **A11y floor (PROG-149):** global `:focus-visible` outline replacing the 24
   `focus:outline-none` suppressions, dialog semantics + focus trap + listbox
   ARIA on the palette/modals, `prefers-reduced-motion` guard.
6. **Micro type on-system (PROG-147):** `--text-2xs`/`--text-3xs` rem tokens
   replace the 17 arbitrary `text-[10px]`/`text-[11px]` px literals that
   bypassed the 120% root scaling.

**Standing decisions recorded with this entry:**

- **Single light theme is deliberate.** No dark mode; the paper identity is the
  product. Components must stay free of literal colors (tag tints are computed
  from the tag hue, not hardcoded) so a dark ink theme stays cheap if ever
  wanted.
- **The brand mark stays terracotta for now.** Icons/favicon/manifest are
  untouched; splitting "mark" from "interface" is the print-shop pattern the
  report calls defensible. Regenerating the raster icon set is its own piece of
  work if the mark should follow the UI (open question 3 in the report).
- **Tag hues remain the owner's cross-product brand set** (D27's seven-color
  hash is unchanged); only their rendering changed.

**Consequences.** `brand-assets/tokens.css` and the `@theme` block in
`src/client/styles.css` change together (the former stays the source of truth).
`index.html` `theme-color` follows the new paper. The critique's full findings
(C1–C4, S1–S8, CR1–CR7, N1–N6) are the arc's work list; anything deliberately
not taken (fonts CDN → self-host was taken; icon regeneration was not) is named
here rather than silently dropped.

---

## Appendix — full audit report (2026-08-04)

# Progress — Design Audit (PROG-146)

Auditor: design-director review, read-only. Sources: full read of `src/client/styles.css`, `brand-assets/tokens.css`, `index.html`, all shared components, all pages/views, plus greps over the whole client for every color/type/radius/shadow/z/motion literal. All contrast ratios below were computed (WCAG 2.x relative-luminance) from the actual hex pairs in the code, including alpha-blended washes.

---

## 1. Read

This is a deliberately *papery* single-user tracker: one warm neutral ramp ("ink" on "paper/canvas/card"), two semantic accents — terracotta **adobe** for "active/now" and olive **moss** for "done" — Spectral serif for everything, IBM Plex Mono for keys/labels/meta, and Linear-derived shape-coded indicators (status pies, priority bars, estimate gauge) where shape and color both carry meaning. The token discipline is genuinely good: one `@theme` block (`styles.css:9-50`) mirrored from `brand-assets/tokens.css`, and essentially zero stray color literals in components — the grep found only token fallbacks and test fixtures. The intent is "a calm printed worksheet, not a SaaS dashboard," and structurally it achieves that. The problem the owner senses is real but narrow: every neutral and the primary accent sit in the same yellow-brown hue band, so the whole app reads as the prevailing warm-paper/humanist-tech house style — the system is distinctive in its *bones* (serif + mono + shape-coded glyphs) and generic in its *color*.

## 2. Verdict

**A well-built system wearing a borrowed coat — 7/10.** Defense: token discipline, component sharing (FilterBar, FilterSelect, NAV, indicators, fields), z-index (only 40/50), breakpoints (only `sm:`/`md:`), and type scale (sm/xs dominate) are all tighter than most teams ship — roughly 80% of this holds. The missing 3 points: a contrast floor that fails WCAG AA on the app's *most used* text color (137 uses of `text-ink-faint` at 2.75–3.19:1), absent dialog semantics and suppressed focus indicators on the keyboard-first surfaces, and the tan monoculture the client brief names. All are fixable as targeted tweaks; none require a refresh.

---

## 3. Findings

### CRITICAL

**C1 — `text-ink-faint` is an AA failure and it is the app's most-used text color.**
Evidence: `styles.css:17` (`--color-ink-faint: #9a8b73`); 137 usages of `text-ink-faint` (grep count), e.g. board card keys `pages/Home.tsx:608`, focus names `Home.tsx:617`, mobile tab labels `MobileTabBar.tsx:62,79`, section headings `Home.tsx:497`, account email `Header.tsx:115`.
Computed: 3.19:1 on card `#fdfaf3`, 2.90:1 on paper, **2.75:1 on canvas** — all fail WCAG 1.4.3 AA (4.5:1 for normal text; this text is `text-xs` and smaller, so no large-text exemption). The mobile tab bar compounds it: 10px labels at 2.75:1.
Why it matters: this tier carries *identifying* information — action keys, container names, section headers — not decoration. On a phone in sunlight it disappears.
Fix: darken the token to **`#776a52`** (≈4.6:1 on card, 4.0:1 on canvas — pass on card where nearly all of it renders) or, with the new palette (§4), **`#6d7568`** (4.78:1 on white). One-line token change; zero component edits. Keep `ink-faint` for genuinely decorative strokes only (glyph tracks), and audit the two `text-ink-faint/50` uses (2 hits) which land near 1.6:1.

**C2 — Tag chips: white 10px text on hashed brand colors, worst case 1.65:1.**
Evidence: `pages/Home.tsx:628-635` (`text-[10px] text-white` on `style={{backgroundColor: tag.color}}`); colors from `src/shared/constants.ts:45-53`.
Computed white-on-tag: `#F2C42E` **1.65:1**, `#F08B23` 2.49:1, `#BA94C4` 2.59:1, `#06A7E0` 2.76:1 — four of seven fail even the 3:1 large-text bar; all fail 4.5:1 (1.4.3). Separately, these seven are cool, fully saturated hues (they are the owner's Mermaid diagram brand set) sitting inside a low-chroma warm-paper UI — they are the loudest pixels on the board and off-system.
Fix: render chips as **tinted washes with dark text**: background = tag hue blended 15% over card, text = a 60%-darkened version of the hue (or plain `text-ink`), 1px border of the hue at 30%. That passes contrast at any hue and drops the chips back into the paper register. ~10 lines in one component.

**C3 — Keyboard-first app, suppressed focus indicators.**
Evidence: 24× `focus:outline-none` (grep). The palette input kills the outline with *no* replacement (`commands/CommandPalette.tsx:138`); form fields replace it with a border shift `line → ink-faint` (`pages/Search.tsx:198`, `pages/Agenda.tsx:178` — 14× `focus:border-ink-faint`), a change of only ~2.3:1 between the two border colors, on a 1px hairline. Buttons/links rely on the UA default ring, which is legal but unstyled and inconsistent with the suppressed inputs.
Why it matters: WCAG 2.4.7 (Focus Visible); this product's identity *is* keyboard flow (palette, single-letter shortcuts). The most keyboard-centric surfaces are the least keyboard-visible.
Fix: one global rule in `@layer base`: `:focus-visible { outline: 2px solid var(--color-adobe); outline-offset: 2px; }` (accent token, whatever it becomes) and delete the 24 `focus:outline-none` in favor of `focus-visible` behavior. Inputs keep the border shift as a secondary cue.

**C4 — Modals have no dialog semantics and no focus trap.**
Evidence: `commands/CommandPalette.tsx:116-122`, `commands/SearchModal.tsx:131`, `commands/CreateActionDialog.tsx:220ff`, `commands/CreateContainerDialog.tsx:106-114` — plain `div`s over a `bg-ink/20` scrim; grep found zero `role="dialog"`, zero `aria-modal`, no inert/trap. The palette list is a `<ul>` of buttons with `data-selected`, not a `listbox` with `aria-activedescendant`, so a screen reader hears nothing as arrow keys move selection. Escape works (handled per-dialog) — good.
Fix: `role="dialog" aria-modal="true" aria-label` on the four containers; palette list → `role="listbox"`/`role="option"` + `aria-activedescendant` on the input; trap Tab within the dialog (small hook, no dependency). This is markup-only; zero visual change.

### STRUCTURAL

**S1 — White-on-adobe CTAs fail AA (3.82:1).**
Evidence: `Header.tsx:73` (New button), `pages/Home.tsx:341` (New action), `FilterBar.tsx:142` (count badge), `SignIn.tsx:26`. Computed: white on `#bb6f50` = **3.82:1** — fails 1.4.3 for `text-sm` (16.8px @120% root, not large). White on `adobe-deep #8f5340` = 6.04:1 — passes.
Fix: make **adobe-deep the resting fill** and adobe the hover, or hold for the §4 accent swap (white on proposed `#3d52c4` = 6.56:1). Also `text-white/70` for the `▾`/`(C)` suffixes (`Header.tsx:75`, `Home.tsx:343`) drops to ~2.7:1 — lift to `/90`.

**S2 — `text-adobe` link text at 3.66:1.**
Evidence: `fields.tsx:14` (`FIELD_ACTION_CLS` — the Move…/Change… triggers on every action page), `App.tsx:111`, `pages/Agenda.tsx:307,368`, `styles.css:204` (`.prose-lite a`). Computed 3.66:1 on card — fails 1.4.3.
Fix: these should use **adobe-deep** (5.79:1). Mechanical swap, 13 sites; underline already carries the affordance so hue can darken freely.

**S3 — Priority "medium" gold fails the non-text minimum; empty bars are near-invisible.**
Evidence: `labels.ts:30-36` — `medium: #c79a31` computed **2.49:1** vs card (2.14 vs canvas), failing WCAG 1.4.11 (3:1 for meaningful graphics); the glyph *is* the only visual once you're scanning corners (`Home.tsx:645`). Unfilled bars render `TRACK` at `opacity 0.3` (`PriorityIndicator.tsx:68`) = 1.35:1 — so "high" (3 bars) vs "medium" (2 bars + 1 ghost) is hard to tell apart at 14px.
Fix: `medium → #a37b16` (3.89:1), `high → #a85a20` (5.06:1), `low → #5a6796` (4.7:1); unfilled bars to opacity 0.55 of the darkened faint token. Shape still carries meaning (good — keep that), but the color channel currently lies.

**S4 — The radius system is defined and then not used: 84 of 138 rounded corners are off-token.**
Evidence: `styles.css:47-49` defines `--radius-sm/md/lg: 6/9/12px`, but the dominant class is bare `rounded` (84 uses) which resolves to Tailwind's default `--radius: 0.25rem` (`node_modules/tailwindcss/theme.css:508`) = **4.8px at the 120% root** — a value that exists nowhere in the token set. Plus `rounded-xl` (4) and `rounded-2xl` (1) which fall back to Tailwind defaults (0.75rem/1rem) — also untokenized.
Why it matters: two near-identical radii (4.8 vs 6) on adjacent controls is exactly the "patched at 11pm" texture; and the brand tokens (`brand-assets/tokens.css:41-44`) claim to be the source of truth.
Fix: add `--radius: 6px` (or `--radius-DEFAULT` per Tailwind v4 namespace) to `@theme` so bare `rounded` = sm, and add `--radius-xl: 14px` for the dialogs. Zero component edits, whole app snaps to the scale.

**S5 — Pixel-literal micro type bypasses the app's own scaling mechanism.**
Evidence: `styles.css:59-61` scales the root to 120% and explicitly relies on "rem-based sizes"; but 17 arbitrary sizes — `text-[10px]` ×9 (`MobileTabBar.tsx:61,78`, tag chips `Home.tsx:630`, …), `text-[11px]` ×7, plus `text-[13px]`/`text-[15px]` — are px and *don't* scale. The smallest real text in the app (10px) is also the one that ignores the sizing system.
Fix: define `--text-2xs: 0.6rem` (≈11.5px effective) and `--text-3xs: 0.55rem` in `@theme`, replace the arbitraries. Two tokens, 17 mechanical swaps.

**S6 — Positional inconsistency across pages — the owner's suspicion is correct.**
Evidence:
- **Page title:** Agenda/Diary/Outline/Archive/Admin open with `<h1 class="text-2xl font-semibold tracking-tight">` (`Agenda.tsx:127`, `Diary.tsx:53`, `Outline.tsx:1671`, `Archive.tsx:49`, `Admin.tsx:25`). The **Board has no h1 at all** — its header is a count + button (`Home.tsx:334-344`) and the first heading on the page is an `<h2>` column label (`Home.tsx:497`). **Search also has no h1** — it opens with a bare input (`Search.tsx:193-199`). Heading order therefore starts at h2 on the two most-visited pages (WCAG 1.3.1-adjacent, and it moves the "where am I" anchor per page).
- **Filters:** Board and Search share `FilterBar` (mobile disclosure, Workspace/Focus/Arc/Tag/Priority, sticky URLs — `FilterBar.tsx:97ff`), but **Agenda hand-rolls a subset** (`Agenda.tsx:134-165`): no Workspace, no Priority, no mobile "Filters" disclosure, so on a phone the Agenda shows a raw select row that the other two pages deliberately collapsed (PROG-81's rationale applies there too).
- **Widths:** board/search full `max-w-screen-2xl`, others `max-w-3xl`, agenda table `max-w-6xl` — this part is *reasoned* (comments justify each) and fine; it's the title/filter drift that isn't.
Fix: a 20-line `PageHeader` component (h1 + count slot + right-side actions slot) used by all seven routes — Board gets `h1 "Board"`, Search gets `h1 "Search"` above the input; Agenda adopts `FilterBar` with its two extras in the `after` slot.

**S7 — One theme, hard-wired.** No `dark:` variant, no `prefers-color-scheme` anywhere (grep: zero), `theme-color` fixed to `#f5efe0` (`index.html:18`). For a single-user paper-identity app this is a defensible *decision*, not a bug — but it is undocumented, and the palette swap in §4 is the moment to decide it on purpose (a dark "ink" theme of this system would be cheap later *only* if components keep zero literal colors, which C2's inline tag styling already violates).

**S8 — `line` is one token doing four jobs.**
Evidence: `--color-line` is simultaneously hairline border (96 uses), hover surface (`hover:bg-line` — Header menu items :89, palette rows `CommandPalette.tsx:157`), inline-code background (`styles.css:180,187`), and column tint (`bg-line/40`, `Home.tsx:495`). Computed: line vs card = 1.28:1, vs canvas = 1.10:1 — as a *border* that softness is a chosen aesthetic, but coupling it to hover states means the palette swap can't tune "how visible are dividers" and "how loud is hover" independently.
Fix: add `--color-hover` (currently = line's value) and point the interactive states at it. Cheap now, expensive later.

### CRAFT

**CR1 — Board card hover is a no-op.** `pages/Home.tsx:602`: `border border-line … hover:border-line` — resting and hover borders are identical, so the primary object of the primary view has zero hover affordance, while sibling rows elsewhere use `hover:border-ink-faint` (`Search.tsx:236`, `Agenda.tsx:229` area, `fields.tsx:132`). Almost certainly a typo for `hover:border-ink-faint`. One word.

**CR2 — Shadow register is heavier than the paper voice.** `shadow-2xl` on palette/dialogs (`CommandPalette.tsx:121`, `SearchModal.tsx:131`, `CreateContainerDialog.tsx:112`), `shadow-xl` on dropdown menus (`Header.tsx:81,112`, `MobileTabBar.tsx:30`), `shadow-lg` + `rotate-1` on the drag card (`Home.tsx:604` — the rotate is a nice touch, keep it). Default Tailwind shadows are neutral-black; on cream they read cool and heavy. Fix: define `--shadow-*` in `@theme` tinted with ink (e.g. `0 8px 30px rgb(44 36 27 / 0.12)` for overlays) and step menus down to `md`, dialogs to `lg`-equivalent.

**CR3 — Selected filter state is nearly invisible.** `FilterSelect.tsx:27-29`: active = `bg-line` vs inactive `bg-card` (1.28:1 apart) plus a hairline border shift. A set filter should read from across the room — this is the control that explains "why is my board empty." Fix: active state = `bg-adobe-wash/40 border-adobe text-adobe-deep` (the pattern the nav active state already uses, `Header.tsx:60`).

**CR4 — Motion is minimal but unguarded.** Only real motion: dnd drop tween 180ms (`dropAnimation.ts:14`), chevron `transition-transform` (`FilterBar.tsx:146`), drag `rotate-1`. No `prefers-reduced-motion` gate (grep: zero). Severity is genuinely low; add one media block zeroing the drop animation duration and transitions for completeness.

**CR5 — Fonts from Google's CDN.** `index.html:33-38`: render-blocking third-party CSS + FOUT on a self-hosted single-user PWA. Self-host the five files (woff2) and preload the two workhorse weights; also makes the app work offline-ish with the manifest.

**CR6 — `tracking-tight` on a serif display face.** All seven h1s pair Spectral semibold with `tracking-tight` (`Agenda.tsx:127` et al.). Tight tracking is a grotesque-sans convention; Spectral's fitted sidebearings go slightly clotted at 2xl. Drop to `tracking-normal` — small, but it's the difference between "serif because we chose it" and "serif wearing sans settings."

**CR7 — Duplicated "New" affordance on the Board only.** Header has the global New menu (`Header.tsx:71-97`) *and* the Board adds its own `New action (C)` button (`Home.tsx:339-344`) — the only page with a second entry point, contributing to S6's header drift. Either every page header carries the context-appropriate New (via the S6 `PageHeader`), or none do.

### NIT

- **N1** — `▾` text glyphs as chevrons (`Header.tsx:75`, `FilterBar.tsx:146`, `Home.tsx` toggles): rendered in Spectral, they vary by platform; the app already has a clean inline-SVG icon system (`nav.tsx:20`) — use it.
- **N2** — Toast system is danger-only styled (`toast.tsx:71`): fine while toasts = failures (per SPEC §8.2), but the first success toast someone adds will ship red. A `tone` prop defaulting to danger future-proofs it.
- **N3** — `Home.tsx:334` uses `<header>` for a non-page-level block and `Search.tsx:345` renders section `<h2>`s without the `font-mono` the identical headings have elsewhere (`Home.tsx:497`, `ActionListView.tsx:125` carry `font-mono`; Search's omits it). Same voice, one page whispers it differently.
- **N4** — `mt-[12vh]` ×3 vs `mt-[8vh]` ×1 for modal vertical position (palette/search/dialogs vs one outlier) — pick one.
- **N5** — Scrim `bg-ink/20` (`CommandPalette.tsx:116`) is light enough that the board underneath competes with the palette; 30–35% reads better with the heavy dialogs, or keep 20% and lighten the dialog shadow per CR2 — either, but co-tune them.
- **N6** — `min-h-8` on empty column bodies (`Home.tsx:502`) gives a 38px drop target for an empty column; consider 44px to match the touch floor used everywhere else (`min-h-11` discipline elsewhere is genuinely good).

**Explicit praise (so the 80% is on the record):** the indicator family (`StatusIndicator`/`PriorityIndicator`/`EstimateIndicator`) sharing one 16×16/`h-3.5` grammar with shape+color dual coding is better accessibility thinking than most commercial trackers; `min-h-11` touch targets and the 16px input floor (`styles.css:114-127`) show a real mobile pass; safe-area handling is textbook; z-index and breakpoint discipline are exemplary; the sticky-filter URL architecture is the right call.

---

## 4. Distinctiveness prescription — "Riso ink on porcelain"

**Diagnosis in one line:** every neutral (`#f5efe0 → #2c241b`) and the primary accent (`#bb6f50`) live in the same ~70–85° yellow-brown hue band — the app is monochrome-warm, which is precisely the current "humanist tech" default (warm paper + terracotta + serif). The *type system and glyph grammar are already distinctive*; only the color is borrowed.

**The move:** keep the ink-on-paper architecture, keep Spectral + Plex Mono, keep the two-accent semantic system (active vs. done) and the moss/olive family (an olive secondary is genuinely uncommon — it's the most ownable color already here). Replace the **tan neutral ramp** with a porcelain ramp (white cards, faint sage-gray canvas — organic without brown), and replace the **terracotta primary** with a printer's ultramarine. The reference is risograph print — ultramarine + olive + paper white — which no Linear-like uses; it keeps the "printed worksheet" soul while killing the tan.

All values computed against WCAG (ratios shown vs. their actual use):

| Token | Now | Proposed | Notes |
|---|---|---|---|
| `--color-card` | `#fdfaf3` | **`#ffffff`** | the owner's "dark text on white-ish cards" — done literally |
| `--color-paper` | `#f5efe0` | **`#f7f7f2`** (oklch 0.975 0.005 110) | header/panels |
| `--color-canvas` | `#f0e9d9` | **`#f0f1ea`** (oklch 0.955 0.008 120) | faint sage, not tan |
| `--color-line` | `#e9dec6` | **`#dfe1d6`** | same 1.3:1 softness, detanned |
| `--color-ink` | `#2c241b` | **`#20251f`** (green-black) | 15.6:1 on card |
| `--color-ink-soft` | `#6b5f4d` | **`#5a6355`** | 6.27:1 on card |
| `--color-ink-faint` | `#9a8b73` | **`#6d7568`** | 4.78:1 on card — fixes C1 in the same stroke |
| `--color-adobe` (rename `--color-accent`) | `#bb6f50` | **`#3d52c4`** ultramarine (oklch ≈ 0.48 0.17 268) | white text on it = 6.56:1 (fixes S1); as link text on card = 6.56:1 (fixes S2) |
| `--color-adobe-deep` | `#8f5340` | **`#2d3c96`** | hover/active fill, 9.55:1 under white |
| `--color-adobe-light` | `#d89572` | **`#8a97e0`** | rings/highlights |
| `--color-adobe-wash` | `#efb892` | **`#dde1f7`** | nav-active / status-panel tint |
| `--color-moss` | `#79864c` | **`#6c7a42`** | done disc now 4.67:1 vs white card (passes 1.4.11) |
| `--color-moss-deep` | `#566039` | **`#4f5c31`** | 7.22:1 as text |
| `--color-danger` | `#b23c28` | **keep `#b23c28`** | 5.88:1 on white; already good, and warm danger against cool accent gains meaning |
| priority `high/medium/low` | `#bd6a30/#c79a31/#6f7896` | **`#a85a20` / `#a37b16` / `#5a6796`** | 5.06 / 3.89 / 4.7 vs card (fixes S3) |
| tag chips | white on 7 brand hues | tint-wash chips per C2 | hue-agnostic, always passes |

**What stays:** Spectral/Plex Mono pairing, the 120% root, all glyph shapes, moss = done semantics, layout, spacing, the entire component grammar, the tomato danger. **What goes:** every tan surface, terracotta as primary, the Mermaid-brand tag chips as solid fills. **Mechanically:** because the discipline is real, this is ~20 lines in `styles.css` `@theme` + the same in `brand-assets/tokens.css` + `labels.ts` + `index.html:18` theme-color + regenerated brand icons (`brand-assets/` PNGs/SVG are terracotta — the one real cost).

**Shelf-life, honestly:** riso ultramarine+olive is itself having a print-nostalgia moment; expect it to read sharply distinct from the Linear-likes and warm-paper apps for ~3–5 years, then merely pleasant. The durable identity here is the serif/mono/glyph system — the palette is a coat, and this one at least isn't the coat everyone else is wearing. **Fallback if the owner wants to stay warm:** keep the porcelain neutrals but use vermilion **`#c2451f`** (white text 5.04:1) as primary — warmth without brown; it is, however, closer to the crowd than the ultramarine.

---

## 5. Strategy (impact ÷ effort, honoring "tweaks not refresh")

**This week (hours, no visual redesign):**
1. C1: darken `--color-ink-faint` (one line; if not doing the palette yet, `#776a52`).
2. CR1: fix the dead `hover:border-line` on board cards (one word).
3. S1/S2: adobe-deep for CTA fills and link text (mechanical).
4. S3: three priority hex values in `labels.ts` + bar opacity.
5. C3: global `:focus-visible` rule; remove `focus:outline-none`s.
6. C2: tag-chip tint treatment.
7. C4: dialog roles/aria (markup only).

**This month (the identity move + system tightening):**
1. §4 palette swap in tokens + brand assets, with S7's theme decision made explicitly and recorded in `docs/decisions/`.
2. S4: `--radius` default + xl token.
3. S5: `--text-2xs/3xs` tokens, replace the 17 px literals.
4. S6/CR7: `PageHeader` component; h1 on Board and Search; Agenda adopts `FilterBar`.
5. CR2 tinted shadow tokens; CR5 self-hosted fonts; S8 `--color-hover`.

**Leave alone:** the type pairing, the indicator glyph family, spacing scale, z-index, breakpoints, nav/tab-bar architecture, safe-area work, the motion budget (add only the CR4 media guard), the per-page width strategy (it's reasoned), and the entire optimistic-UI interaction model.

## 6. Open questions

1. **Dark mode:** is single-theme a standing decision? The palette swap is the cheapest moment ever to either commit ("paper only, recorded") or leave the door open (keep components literal-free — C2's inline styles are the only current violation).
2. **Tag colors:** the seven chip hues are the owner's Mermaid brand set (`constants.ts:45` traces to the global CLAUDE.md palette). Is cross-product brand alignment intended, or should tags derive from the app palette? (The tint-wash fix in C2 works either way.)
3. **How attached is the owner to terracotta as *brand* (icons, favicon, manifest) vs. as *UI accent*?** The icon set in `brand-assets/` is the real switching cost; if the mark must stay terracotta, the vermilion fallback keeps UI and mark in one family, while ultramarine would split "mark" from "interface" — defensible (many print shops do exactly this) but it should be chosen, not drifted into.
