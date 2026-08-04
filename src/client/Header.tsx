// Persistent app header (SPEC v2 §4): the always-available navigation and the
// "New" entry point (Action · Workspace · Focus · Arc). Structure creation is
// now discoverable everywhere, not just via the command palette. The New menu
// reuses the existing optimistic create flows (the command-layer event bus);
// no new write paths.

import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  openCreateContainer,
  openCreateAction,
  type ContainerDialogRequest,
} from "./commands/controller";
import { ChevronDownGlyph } from "./glyphs";
import { NAV } from "./nav";
import { useSnapshotSlice } from "./store";

// End the session, then reload — an unauthenticated load bounces to sign-in.
async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/";
  }
}

export default function Header() {
  const [path] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const me = useSnapshotSlice((ws) => ws.me);
  const isSuperAdmin = useSnapshotSlice((ws) => ws.isSuperAdmin);

  const newItems: { label: string; run: () => void }[] = [
    { label: "Action", run: () => openCreateAction() },
    ...(["workspace", "focus", "arc"] as const).map((kind) => ({
      label: kind[0]!.toUpperCase() + kind.slice(1),
      run: () => openCreateContainer({ kind } as ContainerDialogRequest),
    })),
  ];

  return (
    // pwa-safe-top + pwa-safe-x: in an installed iOS app the bar paints up under
    // the status bar / Dynamic Island and clears the rounded corners, while the
    // inner row stays tappable below them. Inert (0px) in the browser.
    <header className="pwa-safe-top pwa-safe-x sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-screen-2xl items-center gap-1 px-3 py-2 sm:px-6">
        <Link href="/" className="mr-2 font-semibold text-ink">
          Progress
        </Link>
        {/* Inline nav is desktop-only; on phones the bottom tab bar
            (MobileTabBar) carries navigation so the header can't overflow and
            scroll sideways (PROG-79). */}
        <nav className="hidden items-center gap-1 text-sm sm:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded px-2 py-1 ${
                item.match(path)
                  ? "bg-accent-wash/40 text-accent-deep"
                  : "text-ink-soft hover:bg-hover hover:text-ink"
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
              className="inline-flex min-h-11 items-center rounded bg-accent px-3 py-1 text-sm text-white hover:bg-accent-deep sm:min-h-0"
            >
              New <ChevronDownGlyph className="ml-1 h-3.5 w-3.5 shrink-0 text-white/90" />
            </button>
            {menuOpen && (
              <>
                {/* Click-away backdrop. */}
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-md">
                  {newItems.map((item) => (
                    <button
                      key={item.label}
                      onClick={() => {
                        setMenuOpen(false);
                        item.run();
                      }}
                      className="flex min-h-11 w-full items-center px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-hover sm:min-h-0"
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
                className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-wash/60 text-sm font-medium text-accent-deep hover:bg-accent-wash sm:h-8 sm:w-8"
              >
                {me.name.slice(0, 1).toUpperCase()}
              </button>
              {acctOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAcctOpen(false)} />
                  <div className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-md">
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
                        className="flex min-h-11 w-full items-center px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-hover sm:min-h-0"
                      >
                        Admin
                      </Link>
                    )}
                    <button
                      onClick={signOut}
                      className="flex min-h-11 w-full items-center px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-hover sm:min-h-0"
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
