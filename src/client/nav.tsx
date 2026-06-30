// The top-level navigation destinations, shared by the desktop header's inline
// nav (Header.tsx) and the mobile bottom tab bar (MobileTabBar.tsx) so the two
// can't drift (PROG-79). Each item carries an `icon` (used only by the tab bar;
// the desktop nav is text-only) and a `primary` flag: the four primary surfaces
// get their own bottom tab, the rest live behind a "More" tab — the standard
// iOS 5-slot pattern. Desktop shows all six inline.

import type { ReactNode } from "react";

export type NavItem = {
  href: string;
  label: string;
  match: (path: string) => boolean;
  icon: ReactNode;
  // True ⇒ gets its own bottom tab on mobile; false ⇒ lives in the "More" sheet.
  primary: boolean;
};

// Shared SVG props: line icons on `currentColor`, sized for the tab bar.
const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-6 w-6",
  "aria-hidden": true,
};

const BoardIcon = (
  <svg {...ICON}>
    <rect x="3" y="4" width="5" height="16" rx="1" />
    <rect x="9.5" y="4" width="5" height="11" rx="1" />
    <rect x="16" y="4" width="5" height="7" rx="1" />
  </svg>
);

const OutlineIcon = (
  <svg {...ICON}>
    <circle cx="5" cy="6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="5" cy="18" r="1.3" fill="currentColor" stroke="none" />
    <path d="M9 6h11M9 12h11M9 18h11" />
  </svg>
);

const AgendaIcon = (
  <svg {...ICON}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
  </svg>
);

const SearchIcon = (
  <svg {...ICON}>
    <circle cx="11" cy="11" r="6" />
    <line x1="15.5" y1="15.5" x2="20" y2="20" />
  </svg>
);

const StructureIcon = (
  <svg {...ICON}>
    <rect x="9" y="3.5" width="6" height="4" rx="1" />
    <rect x="3.5" y="16.5" width="6" height="4" rx="1" />
    <rect x="14.5" y="16.5" width="6" height="4" rx="1" />
    <path d="M12 7.5V12M6.5 16.5V13h11v3.5" />
  </svg>
);

const ArchiveIcon = (
  <svg {...ICON}>
    <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
    <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5" />
    <line x1="10" y1="12.5" x2="14" y2="12.5" />
  </svg>
);

// Three filled dots — the "More" tab glyph.
export const MoreIcon = (
  <svg {...ICON}>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const NAV: NavItem[] = [
  { href: "/", label: "Board", match: (p) => p === "/", icon: BoardIcon, primary: true },
  { href: "/outline", label: "Outline", match: (p) => p.startsWith("/outline"), icon: OutlineIcon, primary: true },
  { href: "/agenda", label: "Agenda", match: (p) => p.startsWith("/agenda"), icon: AgendaIcon, primary: true },
  { href: "/search", label: "Search", match: (p) => p.startsWith("/search"), icon: SearchIcon, primary: true },
  { href: "/structure", label: "Structure", match: (p) => p.startsWith("/structure"), icon: StructureIcon, primary: false },
  { href: "/archive", label: "Archive", match: (p) => p.startsWith("/archive"), icon: ArchiveIcon, primary: false },
];
