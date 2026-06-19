// Persistent app header (SPEC v2 §4): the always-available navigation and the
// "New" entry point (Issue · Initiative · Product · Repo · Arc). Structure
// creation is now discoverable everywhere, not just via the command palette.
// The New menu reuses the existing optimistic create flows (the command-layer
// event bus); no new write paths.

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { openCreateContainer, openCreateIssue, type ContainerDialogRequest } from "./commands/controller";

const NAV: { href: string; label: string; match: (path: string) => boolean }[] = [
  { href: "/", label: "Board", match: (p) => p === "/" },
  { href: "/agenda", label: "Agenda", match: (p) => p.startsWith("/agenda") },
  { href: "/structure", label: "Structure", match: (p) => p.startsWith("/structure") },
];

export default function Header() {
  const [path] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const newItems: { label: string; run: () => void }[] = [
    { label: "Issue", run: () => openCreateIssue() },
    ...(["initiative", "product", "repo", "arc"] as const).map((kind) => ({
      label: kind[0]!.toUpperCase() + kind.slice(1),
      run: () => openCreateContainer({ kind } as ContainerDialogRequest),
    })),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-screen-2xl items-center gap-1 px-3 py-2 sm:px-6">
        <Link href="/" className="mr-2 font-semibold tracking-tight text-ink">
          Progress
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded px-2 py-1 ${
                item.match(path)
                  ? "bg-adobe-wash/40 text-adobe-deep"
                  : "text-ink-soft hover:bg-line hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="relative ml-auto">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded bg-adobe px-3 py-1 text-sm text-white hover:bg-adobe-deep"
          >
            New <span className="text-white/70">▾</span>
          </button>
          {menuOpen && (
            <>
              {/* Click-away backdrop. */}
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-xl">
                {newItems.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      setMenuOpen(false);
                      item.run();
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-line"
                  >
                    New {item.label.toLowerCase()}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
