// Persistent app header (SPEC v2 §4): the always-available navigation and the
// "New" entry point (Issue · Initiative · Product · Repo · Arc). Structure
// creation is now discoverable everywhere, not just via the command palette.
// The New menu reuses the existing optimistic create flows (the command-layer
// event bus); no new write paths.

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { openCreateContainer, openCreateIssue, type ContainerDialogRequest } from "./commands/controller";
import { useWorkspaceSlice } from "./store";

// End the session, then reload — an unauthenticated load bounces to sign-in.
async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/";
  }
}

type NavItem = { href: string; label: string; match: (path: string) => boolean };

const NAV: NavItem[] = [
  { href: "/", label: "Board", match: (p) => p === "/" },
  { href: "/outline", label: "Outline", match: (p) => p.startsWith("/outline") },
  { href: "/agenda", label: "Agenda", match: (p) => p.startsWith("/agenda") },
  { href: "/search", label: "Search", match: (p) => p.startsWith("/search") },
  { href: "/structure", label: "Structure", match: (p) => p.startsWith("/structure") },
  { href: "/archive", label: "Archive", match: (p) => p.startsWith("/archive") },
];

export default function Header() {
  const [path] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const me = useWorkspaceSlice((ws) => ws.me);
  const isSuperAdmin = useWorkspaceSlice((ws) => ws.isSuperAdmin);

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

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
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

          {/* Signed-in identity + sign out (PROG-34). */}
          {me && (
            <div className="relative">
              <button
                onClick={() => setAcctOpen((o) => !o)}
                title={me.email}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-adobe-wash/60 text-sm font-medium text-adobe-deep hover:bg-adobe-wash"
              >
                {me.name.slice(0, 1).toUpperCase()}
              </button>
              {acctOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAcctOpen(false)} />
                  <div className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-xl">
                    <div className="border-b border-line px-3 py-2 text-sm">
                      <div className="font-medium text-ink">{me.name}</div>
                      <div className="truncate text-xs text-ink-faint">{me.email}</div>
                    </div>
                    {/* Admin (allowlist) lives here, not in the top nav — it's a
                        rare super-admin destination (D44). */}
                    {isSuperAdmin && (
                      <Link
                        href="/admin"
                        onClick={() => setAcctOpen(false)}
                        className="block w-full px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-line"
                      >
                        Admin
                      </Link>
                    )}
                    <button
                      onClick={signOut}
                      className="block w-full px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-line"
                    >
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
