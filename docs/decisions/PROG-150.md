### PROG-150 — Theme presets: porcelain, adobe, sanzo

**Status:** shipped (2026-08-05). Extends PROG-146's "Riso ink on porcelain"
guideline from a single fixed light theme to a single light **mode** (still no
dark mode) with three user-selectable color **presets**.

**Mechanism.** Tailwind v4's `@theme` block (`src/client/styles.css`, mirrored
from `brand-assets/tokens.css`) compiles every color utility to
`var(--color-*)` and emits the values as `:root` custom properties, so a theme
is a pure CSS override block: `:root[data-theme="adobe"] { --color-paper: …;
… }` / `:root[data-theme="sanzo"] { … }`. **Porcelain stays the `@theme`
default and needs no block** — `data-theme` absent or `"porcelain"` both
render it. Each override block replaces only the neutral ramp
(paper/canvas/card/line/hover/ink/ink-soft/ink-faint), the accent family
(accent/-deep/-light/-wash), the moss family (same four steps), and the
prompt trio (text/border/bg). **Danger, the priority ramp, radius, and shadows
stay global across every theme** — re-verified below, not just assumed: the
ink-tinted shadows read fine under all three near-black inks (they're low-
opacity `rgb(32 37 31 / …)` regardless of which ink is live, and the specific
ink hue is imperceptible at 6–18% opacity), and danger/priority both clear
their WCAG floors against all three themes' card colors (table below) so
there's nothing theme-specific worth saying with a second set of hex values.

Persistence follows the `viewPrefs.ts`/`outlinePrefs.ts` idiom
(`src/client/theme.ts`): `THEMES` metadata (id, label, description, a picker
swatch of paper/accent/moss), `getTheme()`/`setTheme(id)`, one fail-soft
`localStorage` key `progress:theme`. `setTheme` flips
`document.documentElement.dataset.theme` and retints `<meta
name="theme-color">` synchronously — no reload, no spinner.

**No-flash boot.** `public/_headers`' CSP is tuned to exactly what
`index.html` loads and had no `'unsafe-inline'` for scripts (PROG-65) — adding
it just to unblock one four-line boot script would gut that policy for
everything. Took the **sha256-hash route** instead: a small inline `<script>`
in `index.html`'s `<head>` (before any stylesheet/paint) reads
`localStorage["progress:theme"]` and applies `data-theme` +
`theme-color` synchronously; the CSP allowlists that exact script by content
hash (`'sha256-PC4NYtVSy/1FYcx3HxHkJj6hpqWfz9s4GNHJzYN1zr4='`), so the policy
stays pinned to one known script rather than opening the door to any inline
code. The script can't `import` `theme.ts` (nothing is bundled yet at that
point in the load), so it duplicates the theme-id → paper-color pairs;
`index.html`'s comment on the script is the reminder to keep them in sync if a
theme is added, removed, or recolored. Regenerate the hash with:
`openssl dgst -sha256 -binary <(sed -n '/<script>/,/<\/script>/p' index.html | sed '1d;$d') | openssl base64`
(or the equivalent one-liner in the script's own comment) whenever its text
changes — a stale hash fails silently (the script just doesn't run; the CSP
violation is console-only), so this is worth remembering deliberately.

**Adobe — contrast-corrected, not verbatim.** The pre-PROG-145 "Adobe & Moss"
warm-earth palette failed the PROG-146 audit's own AA floor (that audit is why
it was replaced with porcelain as the *default* in the first place), so
restoring it unmodified as a selectable preset would let the picker offer a
theme that fails the product's own standing accessibility bar. Three specific
findings needed correction, all traceable to the PROG-146 audit appendix:

- **C1** — `ink-faint` at the old `#9a8b73` was 2.75–3.19:1 against
  paper/card/canvas, below the 4.5:1 AA floor for the app's most-used text
  color (137 usages: action keys, container names, section headers). Uses the
  audit's own corrected value, **`#776a52`** (5.08:1 on the adobe card,
  4.38:1 on adobe canvas — passes where nearly all of it renders, same
  standing exception PROG-146 recorded for the porcelain ink-faint token).
- **S1/S2** — white text on the old primary `#bb6f50` was 3.82:1 (fails), and
  `#bb6f50` as link/text-on-card was 3.66:1 (fails). Fixed the same way
  PROG-145 fixed it for porcelain: **the old `adobe-deep` (`#8f5340`) becomes
  the resting accent fill** (6.04:1 white-on-accent, 5.79:1 as text-on-card),
  and the old core `#bb6f50` drops down to `accent-light`. A new
  `accent-deep`, `#74412f`, was derived as a darker step of the same
  terracotta hue for hover/active states (8.27:1 white, 7.93:1 text-on-card).
- **Moss** — the old `#79864c` measured 3.78–3.94:1 across the adobe
  surfaces in this rebuild (higher than the audit's rough "~2.9:1" estimate,
  which was likely eyeballed against the *porcelain* white card rather than
  adobe's own cream card) — already technically past the 3:1 non-text-graphic
  floor it needs (moss renders as small icon glyphs, not body text: the Step
  icon and `LevelIcon`). Nudged it further past the floor anyway for a real
  margin rather than leaving it path-of-least-resistance-passing: **`#707c46`**
  (4.32:1 on card), same ~73–75° hue as the original.
- **Prompt trio** — the old text `#a85c3d` on the old bg `#f7e7dc` measured
  4.09:1, short of 4.5. Darkened minimally (same hue/saturation, lightness
  42→ down a few points) to **`#9d5639`** (4.56:1).

Everything else in the adobe block (`paper`/`canvas`/`card`/`line`/`ink`/
`ink-soft`, `accent-wash`, `moss-deep`/`-light`/`-wash`, `prompt-border`/`-bg`)
is the original pre-PROG-145 value, unmodified — those all already cleared the
floor (see the table below).

**Sanzo — new, derived from Wada Sanzo classic combination #342.** Base
colors: Corinthian Pink `#f8b6ba` (HSL 356°, 83%, 84%), Cream Yellow `#fdbf68`
(35°, 97%, 70%), Orange Citrine `#986f2d` (37°, 54%, 39%), Deep Slate Olive
`#253122` (108°, 18%, 16% — a true green, not the ~130° the brief
approximated; used the actual measured hue). Every derived value is a shade of
one of these four hues, held at the base's hue while stepping saturation/
lightness for role:

| Role | Value | Derivation |
|---|---|---|
| `ink` | `#253122` | Deep Slate Olive itself |
| `ink-soft` | `#496043` | same hue/sat, L 16→32 |
| `ink-faint` | `#5d7557` | same hue, sat trimmed, L→40 (4.90:1 floor on card) |
| `card` | `#fefbf3` | Cream Yellow hue, very low sat, L 97.5 — "near-white warm cream" |
| `paper` | `#f9f4e9` | Cream Yellow hue, L 94.5 |
| `canvas` | `#f2ebde` | Cream Yellow hue, L 91 |
| `line`/`hover` | `#e4d7c3` | leans toward Orange Citrine's hue (37°), L 83 |
| `accent` | `#b04249` | Corinthian Pink's hue (356°), sat 45.5%, L 47.5 |
| `accent-deep` | `#8c3136` | same hue, L→37 |
| `accent-light` | `#e0858a` | same hue, sat 60%, L 70 |
| `accent-wash` | `#f9c7ca` | same hue, near the Corinthian Pink base itself |
| `moss` | `#4e8042` | Deep Slate Olive's hue, sat raised to 32% (distinct from the low-sat ink ramp on the same hue), L 38 |
| `moss-deep` | `#345a2b` | same hue, L→26 |
| `moss-light` | `#81b474` | same hue, L→58 |
| `moss-wash` | `#d2e4cd` | same hue, L→85 |
| `prompt-text` | `#7a571f` | Orange Citrine's hue, L→30 |
| `prompt-border` | `#dfc79f` | Orange Citrine's hue, L→75 |
| `prompt-bg` | `#f6eddf` | Orange Citrine's hue, L→92, pale wash |

Note on `moss` vs `ink`: both trace to Deep Slate Olive's hue (108°), which
risked reading as one indistinct green — differentiated by saturation (moss
32% vs. ink's 15–18%) and lightness, the same way porcelain's ink (green-black,
low-sat) and moss (olive, higher-sat) already sit on adjacent-but-distinct
green territory.

**Contrast validation — every claimed pair, both new themes.** Computed with a
throwaway WCAG relative-luminance script (not committed); the tag-chip module
(`src/client/tags.ts`) already carries a production copy of the same formula,
cross-checked against it. All PASS:

| Pair | Adobe | Sanzo | Floor |
|---|---|---|---|
| ink vs card | 14.65:1 | 13.18:1 | 4.5 (12 claimed for sanzo ink — met) |
| ink vs canvas | 12.62:1 | 11.49:1 | 4.5 |
| ink-soft vs card | 5.98:1 | 6.69:1 | 4.5 |
| ink-soft vs canvas | 5.15:1 | 5.83:1 | 4.5 |
| ink-faint vs card | 5.08:1 | 4.90:1 | 4.5 |
| ink-faint vs canvas | 4.38:1 | 4.27:1 | informational (PROG-146 precedent: pass-on-card suffices) |
| white vs accent | 6.04:1 | 5.64:1 | 4.5 |
| accent vs card (text) | 5.79:1 | 5.46:1 | 4.5 |
| white vs accent-deep | 8.27:1 | 8.05:1 | 4.5 |
| accent-deep vs card | 7.93:1 | 7.79:1 | 4.5 |
| moss vs card | 4.32:1 | 4.52:1 | 3.0 (non-text graphic) |
| moss-deep vs card (text use) | 6.44:1 | 7.68:1 | 4.5 |
| prompt-text vs prompt-bg | 4.56:1 | 5.64:1 | 4.5 |
| focus outline (accent) vs card | 5.79:1 | 5.46:1 | 3.0 |
| focus outline (accent) vs canvas | 4.99:1 | 4.76:1 | 3.0 |
| danger (global, unchanged) vs card | 5.64:1 | 5.69:1 | 4.5 |
| priority `medium` (global, unchanged) vs card | 3.73:1 | 3.76:1 | 3.0 (non-text graphic) |

**What stays global** (same hex in every theme, verified above rather than
assumed): `--color-danger`/`-bg`/`-border`, the priority ramp in `labels.ts`
(`urgent`/`high`/`medium`/`low`), `--radius-*`, `--shadow-*`. The
Status/Priority/Estimate indicator components' `var(--token, #hex)` fallbacks
need no change — they resolve the live CSS variable, which already tracks the
active theme; the `#hex` fallback only fires outside a browser context that
evaluates custom properties.

**What stays static** (deliberately theme-blind, both noted at their sites):
the sign-in / access-denied pre-auth HTML (`src/worker/pages.ts`) inlines its
own tiny copy of the porcelain palette — it's server-rendered standalone HTML
with no bundle and no `localStorage` reachable at that point in the flow — and
`public/manifest.webmanifest` (PWA install splash / `theme_color`), read once
at install time before any preference exists.

**Ripple check — tag chips.** `tagChipStyle()` (`src/client/tags.ts`, PROG-145
C2) used to blend each tag hue 15%/30% over a literal white in JS and return
resolved hex colors. With three card colors now live, that would either paint
tag chips a fixed white-derived wash regardless of theme, or require
recomputing the wash in JS on every theme change. Moved the wash/border to CSS
`color-mix(in srgb, <hue> 15%, var(--color-card))` (border 30%) — the browser
resolves it against whichever `--color-card` is live, zero JS re-render on
theme switch. The precomputed dark **text** hex stays JS-side (color-mix
output isn't readable back into JS without a live DOM to query), but the
darkening loop was widened to require ≥4.5:1 against the wash over **all
three** theme cards, not just white — two of the seven brand hues (`#ED6245`
tomato, `#D4569F` fuchsia) passed against white-mixed-wash but fell just under
4.5:1 against the adobe/sanzo cream-mixed wash, so the old white-only
computation would have shipped a chip that failed AA under those two themes.
Unit tests (`tags.test.ts`) updated to assert the CSS `color-mix(...)` string
shape and the ≥4.5:1 floor against all three theme cards.

**Not touched, confirmed rather than assumed:** the Status/Priority/Estimate
indicator `var(--token, #hex)` fallbacks (see above); the seven Mermaid-brand
tag hues themselves (D27) — only their rendering surface moved, per PROG-145's
precedent.

### PROG-150b — Mono preset and priority-color tokens

**Status:** shipped (2026-08-05). Adds a fourth preset, **Mono** — "totally
monochrome": shades of black & white only, including the two things the
original three presets deliberately left global (danger, the priority ramp)
and the one thing no preset could reach at all (tag hues). Also promotes
priority colors from hex literals to theme tokens so a preset can reach them.

**Priority colors → theme tokens.** `PRIORITY_COLORS` (`src/client/labels.ts`)
held `high`/`medium`/`low` as literal hex — the one colored thing porcelain/
adobe/sanzo couldn't touch (danger and priority were explicitly "stay global"
in the original PROG-150 entry above). Added `--color-priority-high/medium/low`
to the `@theme` block (`src/client/styles.css`) at the existing global values
(`#a85a20`/`#a37b16`/`#5a6796`), mirrored into `brand-assets/tokens.css` as
`--priority-high/medium/low`. `labels.ts` now reads
`var(--color-priority-high, #a85a20)` etc. — the same `var(token, #hex)`
fallback idiom `StatusIndicator`/`EstimateIndicator` already used, so
`PriorityIndicator` needed no change beyond the string source. `urgent` stays
a literal (`#b23c28`, aliasing `--color-danger`, which is itself global outside
mono) rather than adding a fourth token for a value already sourced elsewhere;
`none` stays `null` (unfilled bars, no fill).

**Consumer audit — no color math found.** Grepped every `PRIORITY_COLORS`
reference: `PriorityIndicator.tsx` is the sole consumer, and it only ever
does `fill={color}` on an SVG `<rect>`/`<circle>` — a straight pass-through,
never arithmetic (no darkening, no contrast computation, no string parsing of
the hex). No test asserted the old hex literals either, so nothing needed
updating beyond the source values. This means the `var(...)` string is safe
to ship with zero ripple beyond `labels.ts` and the two CSS files.

**The gray ramp.** All zero-chroma (R=G=B), so hue can't leak back in through
rounding:

| Token | Value | Role |
|---|---|---|
| `card` | `#ffffff` | raised cards, rows, inputs |
| `paper` | `#f7f7f7` | primary surface |
| `canvas` | `#f0f0f0` | app background |
| `line` / `hover` | `#e0e0e0` | hairlines / hover surfaces |
| `ink` | `#1a1a1a` | primary text |
| `ink-soft` | `#4d4d4d` | secondary text |
| `ink-faint` | `#6b6b6b` | meta/mono labels |
| `accent` | `#111111` | CTA fill / links (near-black + underline carries the link affordance, since hue can't) |
| `accent-deep` | `#000000` | hover/active |
| `accent-light` | `#8a8a8a` | |
| `accent-wash` | `#ececec` | |
| `moss` | `#767676` | Step icon / `LevelIcon` graphic |
| `moss-deep` | `#4d4d4d` | text use |
| `moss-light` | `#ababab` | |
| `moss-wash` | `#e6e6e6` | |
| `prompt-text` | `#3a3a3a` | |
| `prompt-border` | `#c9c9c9` | |
| `prompt-bg` | `#f2f2f2` | |
| `danger` | `#1f1f1f` | overdue/error — heavy near-black, not red (see below) |
| `danger-bg` | `#efefef` | |
| `danger-border` | `#c4c4c4` | |
| `priority-high` | `#333333` | |
| `priority-medium` | `#6b6b6b` | |
| `priority-low` | `#8a8a8a` | ≥3:1 on card, matching the non-text-graphic floor the porcelain/adobe/sanzo ramp already holds to |

**Contrast validation.** Computed with the same throwaway WCAG script used for
adobe/sanzo (formula cross-checked against `src/client/tags.ts`'s production
copy). All PASS against the floors PROG-150's original table actually claims
(ink/accent/moss/danger/priority/focus-outline — border-vs-background pairs
like `prompt-border`/`prompt-bg` and `danger-border`/`danger-bg` are NOT held
to a 3:1 floor here, because they never were: porcelain's own
`prompt-border`/`prompt-bg` measures ~1.54:1 and `danger-border`/`danger-bg`
~1.52:1 — these are decorative dividers around a tinted wash, not
graphical-object boundaries WCAG 1.4.11 requires, and mono's ~1.5:1 for the
same pairs is consistent with that existing precedent, not a regression):

| Pair | Mono | Floor |
|---|---|---|
| ink vs card | 17.40:1 | 4.5 |
| ink vs canvas | 15.27:1 | 4.5 |
| ink-soft vs card | 8.45:1 | 4.5 |
| ink-soft vs canvas | 7.42:1 | 4.5 |
| ink-faint vs card | 5.33:1 | 4.5 |
| ink-faint vs canvas | 4.68:1 | informational (PROG-146 precedent: pass-on-card suffices) |
| white vs accent | 18.88:1 | 4.5 |
| accent vs card (text/link) | 18.88:1 | 4.5 |
| white vs accent-deep | 21.00:1 | 4.5 |
| accent-deep vs card | 21.00:1 | 4.5 |
| moss vs card (graphic) | 4.54:1 | 3.0 |
| moss-deep vs card (text use) | 8.45:1 | 4.5 |
| prompt-text vs prompt-bg | 10.16:1 | 4.5 |
| focus outline (accent) vs card | 18.88:1 | 3.0 |
| focus outline (accent) vs canvas | 16.57:1 | 3.0 |
| danger vs card | 16.48:1 | 4.5 |
| danger vs danger-bg (text legibility) | 14.33:1 | 4.5 |
| priority high vs card | 12.63:1 | 3.0 |
| priority medium vs card | 5.33:1 | 3.0 |
| priority low vs card | 3.45:1 | 3.0 |

**Danger-without-red — non-color-cue spot check.** "Totally monochrome" means
overdue/error can't lean on redness at all, so PROG-149 (the priority/status
"never color alone" pass) needed to have already given these a text or shape
backup. Checked both surfaces that carry danger styling:

- **Agenda overdue row** (`src/client/pages/Agenda.tsx` `AgendaRow`) — the due
  text isn't just tinted red, it's a real sentence from `relativeDue()`
  (`src/client/dates.ts`): "yesterday", "3 days ago", etc., plus a font-weight
  bump (`font-medium`) and a `bg-danger-bg/50` row tint. Under mono the words
  alone say "overdue" — color was never the only signal.
- **Error toast** (`src/client/toast.tsx`) — the danger tone changes
  border/background/text color, but the toast always renders a plain-language
  failure message (`t.message`) and, for sticky toasts, a labeled Retry
  button. No icon-only or color-only failure state exists to begin with.

Both pass: PROG-149's text-carries-meaning discipline holds up under mono
without any new work here.

**Tag chips and other colored swatches.** `tagChipStyle()`'s wash/border
already resolve via `color-mix(…, var(--color-card))`, so they track mono's
card automatically, but the hue input itself and the precomputed text hex
survive as real color. Rather than recompute in JS (impossible without a live
DOM re-render on a pure attribute-flip theme switch — the explicit constraint
this preset works under), gave every chip a stable `tag-chip` class at its two
render sites (`src/client/pages/Home.tsx` action-card tag list,
`src/client/pages/ActionPage.tsx` the Tags field — grepped for every
`tagChipStyle(`/`tag.color` call site; these are the only two) and added
`:root[data-theme="mono"] .tag-chip { filter: grayscale(1); }`
(`src/client/styles.css`). `grayscale(1)` is luminance-preserving, so the
wash/border/text contrast ratios already verified in the original PROG-150
entry hold under the filter unchanged — spot-checked visually, no shift in
perceived lightness. Grepped separately for other colored tag swatches
(pickers, filter dropdowns, admin tag management): none exist beyond the two
chip sites above and the already-token-based step-card moss rail
(`var(--color-moss)`, Home.tsx) — nothing else needed the class.

**Wiring.** `THEMES` (`src/client/theme.ts`) gained a fourth entry, `mono`
(label "Mono", description "shades of black & white", swatch
paper/accent/moss = `#f7f7f7`/`#111111`/`#767676`); `ThemeId` widened to
include it. The Header picker and the three command-palette theme commands
were already metadata-driven (`THEMES.map(...)`), so both picked up the fourth
preset with no additional code. The no-flash boot script (`index.html`)
duplicates `mono: "#f7f7f7"` into its inline paper-color map, and its sha256
hash was regenerated and updated in `public/_headers` (the documented
one-liner in the script's own comment). `theme.test.ts` updated to expect four
ids, porcelain first.
