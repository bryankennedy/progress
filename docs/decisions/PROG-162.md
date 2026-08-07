### PROG-162 — Workspace context on the all-scope outline: spine on desktop, sticky header on mobile

**Problem.** At `/outline?all=1` a single focus or arc can fill several
viewports; once the workspace header scrolls away, nothing on screen says which
workspace the rows you're looking at belong to.

**Options mocked** (rendered in the real app, screenshotted desktop + mobile):

1. **Spine banner** (the owner's proposal): a full-height hairline rail on the
   section's left edge with the workspace name in sticky vertical text
   (`writing-mode: vertical-rl` + 180° rotate ≈ `sideways-lr`, which reads
   bottom-up like a book spine and has wider browser support). Zero vertical
   cost; costs ~28px of row width.
2. **Sticky workspace header**: the section's header row pins below the app
   bar (`bg-paper/95 backdrop-blur`, the app header's own idiom) while its
   section is in view; the next section pushes it away. Instantly readable and
   a tap-target to the workspace page; costs a permanent ~40px strip of
   viewport height while scrolling and stacks a second chrome bar.
3. **Hybrid — chosen**: spine on `sm+`, sticky header below `sm`. On desktop
   the centered `max-w-3xl` column leaves a dead left gutter — the spine lives
   there for free and vertical space stays untouched. On phones there is no
   gutter and row width is already the scarce resource (titles truncate), so
   the sticky header's height cost is the cheaper one.

Considered and dropped: per-workspace accent colors (an arbitrary-color
assignment problem the porcelain palette deliberately avoids), tinted section
cards (shows a boundary but doesn't *name* the workspace), scroll-spy floating
chip (needs an IntersectionObserver to do what `position: sticky` does for
free — the sticky header *is* the chip, simpler).

**Mechanics.** Both treatments pin off `--app-header-h`, a CSS variable
`Header` publishes from a `ResizeObserver` — the bar's height differs by
breakpoint (the nav row wraps away on phones) and grows by the safe-area inset
in the installed PWA, so a hardcoded offset is wrong somewhere. The spine is
`aria-hidden` with `tabIndex={-1}`: it duplicates the header link's target, so
for keyboard/AT it would be a second identically-named link (it also broke
Playwright strict-mode locators, which was the smoke).

### PROG-162b — Workspace sections leave the collision contest while an action row is held

The spine's ~28px exposed a latent drag bug. `closestCenter` ran every
droppable — including workspace sections, which `resolveActionDrop` has **no
branch for**: an action-row drag whose `over` is a workspace section resolves
to nothing, so no preview, no move. That dead end was mostly masked because a
row target usually won the center contest — but the margin was structurally
thin (the collision rect is the full row, its center ~half a row-width right
of the pointer; a workspace rect's center sits mid-column), and the spine's
28px flipped it: in the e2e cross-workspace move, the section rect won the
entire glide and the drop silently no-opped.

Fix at the class level, not the pixel: the outline's `collisionDetection`
filters workspace sections out of the candidates **only while an action row is
held** — every remaining candidate (row, arc, focus) is a target
`resolveActionDrop` can do something with. Container drags keep the full
field; a focus dropped on a workspace section is exactly how cross-workspace
re-parent works (PROG-140).
