### PROG-145 — Porcelain palette, accent rename, and card standardization

**Status:** shipped (2026-08-04). Implements the palette/surface half of the
PROG-146 "Riso ink on porcelain" guideline (findings C1, C2, S1-remnant, S3,
S4, S8, CR1–CR3, and the card sweep). See `docs/decisions/PROG-146.md` for the
full audit and rationale; this entry records what was implemented and what had
to be derived beyond the audit's §4 table.

**What moved (per the audit table, verbatim):**

- Neutrals → porcelain: card `#ffffff`, paper `#f7f7f2`, canvas `#f0f1ea`,
  line `#dfe1d6`; ink ramp `#20251f` / `#5a6355` / `#6d7568` (ink-faint now
  4.78:1 on card — C1 fixed by the swap itself). Danger family unchanged.
- Terracotta → ultramarine, and the token renamed **`adobe` → `accent`**
  (`#3d52c4`, deep `#2d3c96`, light `#8a97e0`, wash `#dde1f7`) across both
  token files, every Tailwind class in `src/`, the indicator CSS-var fallbacks,
  and the worker access-denied page (`src/worker/pages.ts`, which carries its
  own inline copy of the palette). `index.html` theme-color → `#f7f7f2`.
- Priority ramp (`labels.ts`): high `#a85a20`, medium `#a37b16`, low `#5a6796`
  (urgent stays the danger tomato); unfilled-bar track opacity 0.3 → 0.55
  (S3). Checked the rest of `labels.ts` and the indicator components for other
  tan-tuned literals: the only color literals are `PRIORITY_COLORS` and the
  `var(--token, #hex)` fallbacks in Status/Priority/EstimateIndicator — the
  fallbacks were retuned to the new token values; status colors are pure token
  references and needed nothing.
- Radius: `--radius: 6px` (bare `rounded` now lands on the token scale —
  verified against Tailwind v4, which resolves `rounded` to `var(--radius)`
  from its deprecated-defaults block) and `--radius-xl: 14px`; the one
  `rounded-2xl` (SignIn mark) → `rounded-xl` (S4).
- Shadows: `--shadow-sm…2xl` overridden with ink-tinted values
  (`rgb(32 37 31 / …)`, the new ink); dropdown menus (Header ×2, MobileTabBar
  sheet, and the Outline arc-mover — same pattern, included) stepped
  `shadow-xl → shadow-md`; dialogs/palette (`commands/*` ×4)
  `shadow-2xl → shadow-lg` (CR2). Drag previews keep their heavier shadows on
  purpose (they float).
- `--color-hover` added (= line's value, for now) and all
  `hover:bg-line[/N]`, `focus-within:bg-line`, and the palette/search
  `data-selected:bg-line` highlights point at it (S8); border/divider,
  column-tint, and `.prose-lite` code-background uses of `line` untouched.
- CR1 (board card `hover:border-line` → `hover:border-ink-faint`), CR3
  (FilterSelect active = `bg-accent-wash/40 border-accent text-accent-deep`,
  the nav-active pattern), S1 remnant (`text-white/70` suffixes on
  accent-filled buttons → `/90` — including the action page's "(W)" on Copy
  as prompt, same pattern as the two sites the audit named).

**Derived beyond the audit table (the table left these to implementation):**

- **moss-light `#a7b96e`, moss-wash `#e0e8c9`** — recomputed onto the same
  olive ramp as the new moss (`#6c7a42`, hue ≈75°), keeping their roles:
  light = a mid-light highlight tint paralleling accent-light's lightness,
  wash = a pale tint paralleling accent-wash against the porcelain neutrals
  (the old `#9aa468`/`#bcc189` sat on the tan-adjacent 65–70° band and read
  muddy next to white cards).
- **prompt-\* trio** re-derived from the accent family: text `#2f41a8` (a deep
  accent, ≈7.6:1 on its bg), border `#b9c2ee` (30% tint), bg `#eef0fb` (15%
  wash). Grep first: the trio is referenced nowhere in components today — it
  exists as a brand "functional accent" in the token files — so this is a
  token-file-only change.
- **Tag chips (C2)** — one computed helper, `tagChipStyle(hue)` in
  `src/client/tags.ts`: background = the tag hue blended 15% over white,
  border = 30%, text = the hue scaled toward black (hue-preserving) in 5%
  steps until it clears 4.5:1 against the wash. Used by both chip render
  sites (board card, action page — the only two, by grep). Nothing per-hue is
  hardcoded, honoring PROG-146's literal-free-components standing decision;
  unit tests assert the AA floor across the whole `TAG_COLORS` set.

**Card sweep:** with card now white, the PWA install prompt moved
`bg-paper → bg-card` (it's a raised floating card). Deliberately left on
paper: header/tab-bar chrome, the new-action dialog's inset panels, and the
Admin note-input focus fill — paper is now the *recess* tint inside white
cards, which is its job.

**Not touched here** (owned elsewhere): fonts/`<link>`s and micro-type tokens
(PROG-147), PageHeader/h1 + Agenda FilterBar (PROG-148), focus-visible/dialog
ARIA/motion (PROG-149), and `brand-assets/` icons — the mark stays terracotta
by PROG-146's standing decision.
