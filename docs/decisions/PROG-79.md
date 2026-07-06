### PROG-79 — mobile top nav becomes a bottom tab bar

The header packed the "Progress" logo + six text nav links + the New menu + the
avatar into one row; on a phone that overflowed and scrolled sideways (the issue
is filed under the **Mobile functionality** arc). Fixed by swapping the *pattern*
on small screens, not by trimming destinations.

- **Bottom tab bar on mobile, inline nav on desktop.** Below Tailwind's `sm`
  breakpoint the header's inline `<nav>` is hidden and a fixed bottom tab bar
  (`MobileTabBar.tsx`, `sm:hidden`) takes over; at `sm`+ the bar is hidden and the
  original inline nav returns unchanged. The mobile header is now just logo +
  New + avatar, so it can't overflow.
- **The iOS-standard 5-slot split.** Four primary surfaces get their own tab
  (Board · Outline · Agenda · Search); the rest (Structure · Archive) live behind
  a **More** tab that opens a small sheet above the bar. Chosen over cramming all
  six text tabs across a 375 px phone. Archive was already deemed a rare
  destination (D49) and Structure is curation, so they're the natural pair to
  demote.
- **Active state is always visible** (the issue's explicit ask). The current
  tab's icon + label are lit in the adobe accent; the **More** tab lights when
  its sheet holds the current page (e.g. on `/structure`), so you can always see
  where you are without opening anything. Verified with a real phone-viewport
  browser pass (header 390 px = viewport 390 px, no horizontal scroll).
- **One source of destinations.** The list moved to a shared `nav.tsx` (href,
  label, `match`, an `icon` used only by the bar, and a `primary` flag) imported
  by both the desktop header and the tab bar, so the two can't drift — same
  reasoning as the shared `FilterSelect` (PROG-76).
- **Bottom-anchored chrome lifts above the bar on mobile.** `main` gains
  `pb-24` (cleared at `sm`), and the toast stack + PWA install card float above
  the bar on phones; all use the existing `pwa-safe-bottom` inset so they clear
  the iOS home indicator. *Rejected:* a hamburger menu (hides the active state
  the issue wants kept visible) and a 6-tab bar (too cramped with text labels on
  a narrow phone).
