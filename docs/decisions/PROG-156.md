### PROG-156 — Icons on the desktop top-level nav

**Context.** The shared `nav.tsx` list already carried an `icon` per
destination, but only the mobile bottom tab bar (`MobileTabBar.tsx`) drew it;
the desktop header's inline nav (`Header.tsx`) was text-only. The owner asked to
carry the existing mobile icons into the desktop nav (Design standardization
arc) rather than draw a new set.

**Decision.** Reuse the same icons on both surfaces, sized per surface. The one
blocker was that each icon was a pre-rendered `ReactNode` with a hardcoded
`h-6 w-6`, so the desktop nav couldn't shrink it. Converted each icon from a
node constant into a small size-parametric component (`NavIcon = (props: {
className? }) => ReactNode`), defaulting to `h-6 w-6` so the tab bar is
byte-for-byte unchanged; `NavItem.icon` became `NavItem.Icon`. This mirrors the
`className`-defaulting pattern already used in `glyphs.tsx`.

The desktop nav renders `<item.Icon className="h-4 w-4 shrink-0" />` before the
label in a flex row. Icons stroke on `currentColor`, so they inherit the link's
text color — muted at rest, ultramarine-accent when the tab is active — with no
extra active-state wiring.

**Alternatives rejected.** Overriding the baked `h-6 w-6` from the consumer via
an `[&_svg]:!h-4` wrapper would have worked without touching the icon
definitions, but leans on `!important` and Tailwind arbitrary-variant
specificity — brittle next to a clean component prop. A separate desktop icon
set was rejected outright: the whole ask is standardization, and one source
keeps the two navs from drifting (the reason `nav.tsx` is shared at all).

No API, schema, route, or behavior change — presentation only.
