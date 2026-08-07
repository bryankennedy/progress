// The top-level navigation destinations, shared by the desktop header's inline
// nav (Header.tsx) and the mobile bottom tab bar (MobileTabBar.tsx) so the two
// can't drift (PROG-79). Each item carries an `Icon` component — the bottom tab
// bar renders it at its default tab size, the desktop nav renders it small
// beside the label (PROG-156) — and a `primary` flag: the four primary surfaces
// get their own bottom tab, the rest live behind a "More" tab (the standard iOS
// 5-slot pattern). Desktop shows all six inline.

import type { ReactNode } from "react";

// A nav icon renders at whatever size the caller asks for (PROG-156): the tab
// bar takes the h-6 default, the desktop inline nav passes a smaller box.
export type NavIcon = (props: { className?: string }) => ReactNode;

export type NavItem = {
  href: string;
  label: string;
  match: (path: string) => boolean;
  Icon: NavIcon;
  // True ⇒ gets its own bottom tab on mobile; false ⇒ lives in the "More" sheet.
  primary: boolean;
};

// Shared SVG props: line icons on `currentColor`. Size rides in via `className`
// so one icon serves both the tab bar (h-6) and the desktop nav's smaller box.
const iconProps = (className: string) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  "aria-hidden": true,
});

const BoardIcon: NavIcon = ({ className = "h-6 w-6" }) => (
  <svg {...iconProps(className)}>
    <rect x="3" y="4" width="5" height="16" rx="1" />
    <rect x="9.5" y="4" width="5" height="11" rx="1" />
    <rect x="16" y="4" width="5" height="7" rx="1" />
  </svg>
);

const OutlineIcon: NavIcon = ({ className = "h-6 w-6" }) => (
  <svg {...iconProps(className)}>
    <circle cx="5" cy="6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="5" cy="18" r="1.3" fill="currentColor" stroke="none" />
    <path d="M9 6h11M9 12h11M9 18h11" />
  </svg>
);

const AgendaIcon: NavIcon = ({ className = "h-6 w-6" }) => (
  <svg {...iconProps(className)}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
  </svg>
);

const SearchIcon: NavIcon = ({ className = "h-6 w-6" }) => (
  <svg {...iconProps(className)}>
    <circle cx="11" cy="11" r="6" />
    <line x1="15.5" y1="15.5" x2="20" y2="20" />
  </svg>
);

// A notebook with a margin rule — the daily diary.
const DiaryIcon: NavIcon = ({ className = "h-6 w-6" }) => (
  <svg {...iconProps(className)}>
    <rect x="5" y="3.5" width="14" height="17" rx="2" />
    <path d="M8.5 3.5v17" />
    <path d="M11.5 8h4.5M11.5 11.5h4.5" />
  </svg>
);

const ArchiveIcon: NavIcon = ({ className = "h-6 w-6" }) => (
  <svg {...iconProps(className)}>
    <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
    <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5" />
    <line x1="10" y1="12.5" x2="14" y2="12.5" />
  </svg>
);

// Three filled dots — the "More" tab glyph.
export const MoreIcon: NavIcon = ({ className = "h-6 w-6" }) => (
  <svg {...iconProps(className)}>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const NAV: NavItem[] = [
  { href: "/", label: "Board", match: (p) => p === "/", Icon: BoardIcon, primary: true },
  {
    href: "/outline",
    label: "Outline",
    match: (p) => p.startsWith("/outline"),
    Icon: OutlineIcon,
    primary: true,
  },
  {
    href: "/agenda",
    label: "Agenda",
    match: (p) => p.startsWith("/agenda"),
    Icon: AgendaIcon,
    primary: true,
  },
  {
    // Sits between Agenda and Search: the time-driven pair (what's due, what
    // happened) reads together. Order here drives the desktop inline nav and
    // the More sheet; the bottom tab bar only takes `primary` items.
    href: "/diary",
    label: "Diary",
    match: (p) => p.startsWith("/diary"),
    Icon: DiaryIcon,
    // The bottom bar keeps its four primary tabs (iOS 5-slot pattern); the
    // Diary is a reading surface, reached from More on a phone.
    primary: false,
  },
  {
    href: "/search",
    label: "Search",
    match: (p) => p.startsWith("/search"),
    Icon: SearchIcon,
    primary: true,
  },
  {
    href: "/archive",
    label: "Archive",
    match: (p) => p.startsWith("/archive"),
    Icon: ArchiveIcon,
    primary: false,
  },
];
