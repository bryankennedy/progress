# PROG-149 — Usability / a11y pass

### PROG-149 — Focus visibility, dialog semantics, and the reduced-motion guard

**Context.** PROG-146's design audit found the keyboard-first product least
keyboard-visible: 24 scattered `focus:outline-none` suppressions (C3), zero
dialog semantics or focus trap on the four modal overlays (C4), no
`prefers-reduced-motion` guard (CR4), a scrim reading too light against the
heavy dialogs (N5), a toast system hard-coded to danger styling (N2), and a
scatter of smaller nits (N-series) plus general markup gaps this action's
"semantic sweep" was scoped to find and fix. This entry records the whole
action — the two landed commits plus the remaining items — as one piece, since
they're one arc pass over the same surfaces.

**1. Focus visibility (`715a018`).** One rule in `@layer base`:

```css
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

replacing all 24 `focus:outline-none` suppressions. `:focus-visible` already
distinguishes keyboard focus from a mouse click (a plain click doesn't ring),
so no `:focus { outline: none }` reset is needed and none was added — inputs
keep their `focus:border-*`/`focus:ring` treatments as a secondary cue. Inputs
seated flush inside an `overflow-hidden` dialog frame (the palette/search
inputs) pull the ring inward with `-outline-offset-2` instead of letting the
frame clip it, rather than special-casing those inputs out of the rule.

**2. Dialog semantics, focus trap, listbox ARIA (`99f9456`).** The four modal
overlays — command palette, `/` search modal, and the two create dialogs — get
`role="dialog" aria-modal="true" aria-label` and a shared, dependency-free
`useFocusTrap` hook (`src/client/commands/useFocusTrap.ts`): while active, a
capture-phase `keydown` listener on `document` cycles Tab/Shift-Tab within the
dialog (so it wins over the dialogs' own `onKeyDown` without touching them),
and on deactivate/unmount it restores focus to whatever was focused when the
trap engaged (skipped if that element is no longer connected — e.g. a board
row that re-rendered away). The palette and search modal additionally adopt
the combobox/listbox pattern: the input carries `role="combobox"` +
`aria-expanded`/`aria-controls`/`aria-activedescendant` tracking the
arrow-key selection, and result rows are `role="option"` with stable
per-item ids and `tabIndex={-1}` — arrow keys own the list, Tab is the trap's
job, and focus never leaves the input. Non-selectable rows (group headers,
"No matches", the search footer link) are `role="presentation"` so the
listbox only exposes real options. Menu triggers (header New menu, the
account menu, the mobile "More" tab, the outline's arc-assign menu) declare
`aria-haspopup`/`aria-expanded` alongside — attributes only, no roving
tabindex.

**3. Reduced motion (this action, CR4).** One `@media (prefers-reduced-motion:
reduce)` block in `styles.css`, zeroing `transition-duration`,
`animation-duration`/`animation-iteration-count`, and `scroll-behavior` for
every element (`!important` because it must outrank Tailwind's unlayered
utility classes). That catches every CSS-driven motion in the app (chevron
rotates, the drag-card tilt) except the dnd-kit drop tween, which is a
JS-driven Web Animations call the CSS media query can't reach —
`dropAnimation.ts` checks `window.matchMedia("(prefers-reduced-motion:
reduce)").matches` once at module load and zeroes its `duration` directly.

**4. Scrim (N5).** The four overlays' backdrop moved `bg-ink/20` →
`bg-ink/30` — the audit's read was that 20% let the board underneath compete
with the dialog on top of it; 30% is still light (this is a paper-voice app,
not a heavy SaaS dim) but reads as clearly behind.

**5. Toast tone (N2).** `toast()`/`toastAction()` take an optional `tone:
"danger" | "neutral"` (default `"danger"`, so every existing call site is
unchanged — SPEC §8.2 toasts are failure-only today). `"neutral"` renders
with the standard card/ink/line palette instead of the danger colors, so the
first non-error toast someone adds later doesn't ship red by default. The
toast container also gained `role="status"` per toast, for polite
announcement.

**6. Menu-trigger semantics.** Verified already covered by `99f9456` — the
header New/account menus and the mobile tab bar's "More" trigger already carry
`aria-haspopup`/`aria-expanded`. No further changes needed.

**7. Semantic sweep.** Targeted, not exhaustive — the fixes:

- **Unlabeled selects/inputs.** `FilterSelect` (board/search filter
  dropdowns) gained `aria-label={label}` — its first option shows the label
  as text ("Focus: all"), but once a value is picked the closed select shows
  only the bare option name, so the field's identity needs its own
  announcement. `CreateContainerDialog`'s parent-workspace and parent-focus
  selects gained `aria-label="Workspace"`/`"Focus"`; `CreateActionDialog`'s
  inline "new focus" workspace select gained `aria-label="Workspace for the
  new focus"`. `fields.tsx`'s `FieldSelect` (status/priority/estimate,
  shared by the action page and create dialog) gained an `ariaLabel` prop
  that `IconSelect` now threads from its existing `openLabel` ("Change
  priority" etc.) — the `Field` wrapper's visible label is a plain `<p>`,
  not a `<label for>`, so it wasn't programmatically associated.
  `IconDateInput`'s date input gained `aria-label="Due date"` (its only use).
- **Landmarks** — already fine: `App.tsx` wraps routed content in `<main>`,
  `Header.tsx` is a real `<header>` with a `<nav>` for the desktop links, and
  `MobileTabBar.tsx` is a `<nav>`. No changes.
- **Icon-only buttons** — audited every `<button` across `src/client`
  (~90 call sites). Already labeled: the InstallPrompt dismiss, the Admin
  row's ✕ remove, the toast dismiss ✕, the Diary prev/next-day and
  jump-to-day controls, `ArcMenu`, the outline row `Handle` (a real `<a>`,
  `aria-label` carries the row's name), the sidebar's location/calendar
  gutter buttons (`fields.tsx`). Everything else that looked icon-only turned
  out to carry visible text (ActionTable's sort buttons show the column
  label; `aria-sort` on the `<th>` conveys direction — the arrow glyph is
  decorative and already `aria-hidden`). No missing labels found beyond the
  selects above.
- **Decorative SVGs** — `glyphs.tsx` (workspace/focus/arc/chevron),
  `nav.tsx` (the six nav icons + "More"), and `outline/LevelIcon.tsx` (the
  bullet ladder) were already `aria-hidden` — each sits beside its own text
  (a nav label, "New", a row's title) so the glyph is redundant decoration.
  Left alone. `StatusIndicator`/`PriorityIndicator`/`EstimateIndicator` were
  already the opposite case done right: `role="img"` + `aria-label` + a
  `<title>`, because for those three the glyph *is* the information (shape
  encodes state, not just color) — no `aria-hidden` was added or removed.
- **Landmark/form gaps beyond the above** — none found; the FilterBar
  dropdowns already pass a visible `label` prop into `FilterSelect` (now also
  mirrored into `aria-label`), and dialog text inputs already carry
  `placeholder` + (where no visible label exists) `aria-label` from earlier
  passes.

**Out of scope, left untouched per the brief:** palette/token values, tag
chips, radius/shadows (PROG-145); PageHeader/FilterBar layout (PROG-148);
type sizes/fonts (PROG-147); the `board-reorder` e2e drop-to-top failure; PWA
manifest colors.
