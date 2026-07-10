// The structural breadcrumb (PROG-103): a page's path back up the
// Workspace → Focus → (Repo · Arc) → Action tree, ancestors linked, the
// current location as a plain terminal crumb. Replaces the old "Snapshot /"
// trail — "Snapshot" named the load-everything payload, not a place, and its
// link to the board answered no navigation question. One component so the
// action and container pages can't drift (the experience-consistency arc).

import { Link } from "wouter";

export type Crumb = {
  label: string;
  // Ancestors carry an href; the terminal (current-location) crumb omits it.
  href?: string;
  // Action keys render in the mono face they use everywhere else — both the
  // terminal key and any linked Step parents above it (PROG-106).
  mono?: boolean;
};

export default function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    // One line, truncating rather than wrapping — long container names must
    // not push the title down on a phone.
    <nav aria-label="Breadcrumb" className="truncate whitespace-nowrap text-sm text-ink-faint">
      {crumbs.map((crumb, i) => (
        <span key={i}>
          {i > 0 && " / "}
          {crumb.href ? (
            <Link
              href={crumb.href}
              className={`hover:text-ink-soft${crumb.mono ? " font-mono" : ""}`}
            >
              {crumb.label}
            </Link>
          ) : (
            <span aria-current="page" className={crumb.mono ? "font-mono" : undefined}>
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
