// Bottom tab bar — the mobile-only primary navigation (PROG-79). On phones the
// header's inline nav is hidden (it overflowed and scrolled sideways), and this
// fixed bar takes over: the four primary surfaces get a tab each, the rest sit
// behind a "More" sheet (the iOS-standard 5-slot pattern). The active tab is
// always lit (icon + label in the adobe accent), so you can see where you are at
// a glance without opening anything. Hidden at `sm` and up, where the inline nav
// returns. Destinations come from the shared NAV list so the two can't drift.

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { MoreIcon, NAV, type NavItem } from "./nav";

export default function MobileTabBar() {
  const [path] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = NAV.filter((i) => i.primary);
  const secondary = NAV.filter((i) => !i.primary);
  // "More" reads as active whenever a destination it holds is the current page,
  // so the bar still shows where you are even when the surface isn't a top tab.
  const moreActive = secondary.some((i) => i.match(path));

  return (
    // pwa-safe-bottom/x: clear the iOS home indicator and rounded corners; inert
    // in a desktop browser. backdrop-blur + translucent paper matches the header.
    <nav className="pwa-safe-bottom pwa-safe-x fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 backdrop-blur sm:hidden">
      {moreOpen && (
        <>
          {/* Tap anywhere outside to dismiss the sheet. */}
          <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-full z-50 border-t border-line bg-card pb-1 shadow-xl">
            {secondary.map((item) => {
              const active = item.match(path);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 px-5 py-3 text-sm ${
                    active ? "bg-adobe-wash/40 text-adobe-deep" : "text-ink-soft hover:bg-line"
                  }`}
                >
                  <span className="text-ink-faint">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </>
      )}

      <div className="mx-auto flex max-w-screen-2xl items-stretch">
        {primary.map((item) => (
          <Tab key={item.href} item={item} active={item.match(path)} />
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          aria-current={moreActive ? "page" : undefined}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium ${
            moreActive || moreOpen ? "text-adobe-deep" : "text-ink-faint"
          }`}
        >
          {MoreIcon}
          More
        </button>
      </div>
    </nav>
  );
}

function Tab({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium ${
        active ? "text-adobe-deep" : "text-ink-faint"
      }`}
    >
      {item.icon}
      {item.label}
    </Link>
  );
}
