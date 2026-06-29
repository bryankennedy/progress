// PWA install detection (iOS Safari has no install API — see the iOS PWA notes).
//
// Two install paths exist and they're mutually exclusive per platform:
//   • Chromium (Android, desktop) fires a `beforeinstallprompt` event we can
//     stash and replay on a user gesture — a one-tap native install.
//   • iOS Safari fires nothing and exposes no prompt(). Installation is the
//     manual Share ▸ "Add to Home Screen" flow, so all we can do is *instruct*.
//
// The hook resolves which (if either) applies, stays quiet once the app is
// already running standalone, and respects a persisted dismissal so we ask once,
// not on every load.

import { useEffect, useState } from "react";

// The slice of the Chromium-only event we use. Typed locally — it isn't in lib.dom.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallMode =
  | "none" // already installed, unsupported, or dismissed — show nothing
  | "ios" // iOS Safari: show the manual Add-to-Home-Screen instructions
  | "prompt"; // Chromium: show a button that fires the native prompt

const DISMISS_KEY = "pwa-install-dismissed";

// iOS detection that survives iPadOS 13+, which reports a desktop "Macintosh" UA
// but is a touch device. Exclude in-app browsers (Chrome/Firefox/etc. on iOS),
// where the Share ▸ Add to Home Screen flow isn't available.
function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!iOS) return false;
  // CriOS/FxiOS/EdgiOS = third-party browsers on iOS; they can't install.
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS exposes navigator.standalone; everyone else uses the display-mode query.
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

// Dev/QA affordance: `?install=ios` or `?install=prompt` forces a variant so the
// banner can be reviewed on a desktop browser where neither path triggers
// naturally. Returns null when absent or unrecognised.
function forcedMode(): InstallMode | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("install");
  return v === "ios" || v === "prompt" || v === "none" ? v : null;
}

export type PwaInstall = {
  mode: InstallMode;
  /** Fire the native install prompt (Chromium `prompt` mode only). */
  promptInstall: () => Promise<void>;
  /** Hide the banner and remember the choice so we don't nag on reload. */
  dismiss: () => void;
  /** True when forced via `?install=…` — lets the banner skip the localStorage gate. */
  forced: boolean;
};

export function usePwaInstall(): PwaInstall {
  const forced = forcedMode();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    if (forced) return false;
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      // Keep our own UI in charge: suppress Chrome's mini-infobar, stash the event.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setDeferred(null);
      setDismissed(true);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice; // resolves once the user accepts/dismisses
    setDeferred(null);
  };

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private mode / blocked storage — dismissal is just in-memory this session.
    }
  };

  const mode: InstallMode = (() => {
    if (forced) return forced;
    if (isStandalone() || dismissed) return "none";
    if (deferred) return "prompt";
    if (isIosSafari()) return "ios";
    return "none";
  })();

  return { mode, promptInstall, dismiss, forced: forced !== null };
}
