// Install affordance for the two platforms that benefit from a home-screen app:
//   • Chromium → a single "Install" button wired to the native prompt.
//   • iOS Safari → illustrated Share ▸ Add to Home Screen instructions, since
//     iOS exposes no install API (see the iOS PWA notes).
//
// Rendered globally from App; it returns null whenever there's nothing to offer
// (already installed, unsupported browser, or previously dismissed). The card
// sits above the home indicator via the safe-area pad and matches the paper
// design system. Web Push on iOS only works once installed, so nudging the
// install is also what unlocks future notifications.

import { usePwaInstall } from "./usePwaInstall";

// iOS share-sheet glyph (square with an up-arrow) — the control users tap to
// reach "Add to Home Screen". Drawn inline so it tracks our ink color.
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3v12M12 3l-3.5 3.5M12 3l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v7A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 18.5 10H17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusSquareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 9v6M9 12h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// Shared chrome: a dismissible card pinned to the bottom, clear of the iOS home
// indicator (.pwa-safe-bottom). Width-capped and centered so it reads as a sheet
// on phones without spanning a desktop window.
function Card({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div className="pwa-safe-bottom pwa-safe-x fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-3">
      <div className="relative w-full max-w-md rounded-lg border border-line bg-paper p-4 shadow-xl">
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded text-ink-faint hover:bg-line hover:text-ink"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}

function AppMark({ className }: { className?: string }) {
  return (
    <img
      src="/brand-assets/apple-touch-icon-180.png"
      alt=""
      aria-hidden="true"
      className={className}
    />
  );
}

export default function InstallPrompt() {
  const { mode, promptInstall, dismiss } = usePwaInstall();

  if (mode === "none") return null;

  if (mode === "prompt") {
    return (
      <Card onDismiss={dismiss}>
        <div className="flex items-center gap-3 pr-6">
          <AppMark className="h-11 w-11 flex-none rounded-lg border border-line" />
          <div className="min-w-0">
            <p className="font-semibold leading-tight text-ink">Install Progress</p>
            <p className="text-sm text-ink-soft">
              Add it to your device for a full-screen, app-like view.
            </p>
          </div>
          <button
            onClick={promptInstall}
            className="ml-auto flex-none rounded bg-adobe px-3 py-1.5 text-sm font-medium text-white hover:bg-adobe-deep"
          >
            Install
          </button>
        </div>
      </Card>
    );
  }

  // mode === "ios": no API, so walk the user through the manual Share flow.
  return (
    <Card onDismiss={dismiss}>
      <div className="flex items-start gap-3 pr-6">
        <AppMark className="h-11 w-11 flex-none rounded-lg border border-line" />
        <div className="min-w-0">
          <p className="font-semibold leading-tight text-ink">Add Progress to your Home Screen</p>
          <p className="mt-0.5 text-sm text-ink-soft">
            Full-screen, fast, and one tap from the dock.
          </p>
          <ol className="mt-3 space-y-2 text-sm text-ink">
            <li className="flex items-center gap-2">
              <span className="font-mono text-xs text-ink-faint">1.</span>
              <span className="flex items-center gap-1.5">
                Tap
                <ShareIcon className="inline-block h-5 w-5 text-adobe" />
                <span className="font-medium">Share</span> in the toolbar
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className="font-mono text-xs text-ink-faint">2.</span>
              <span className="flex items-center gap-1.5">
                Choose
                <PlusSquareIcon className="inline-block h-5 w-5 text-adobe" />
                <span className="font-medium">Add to Home Screen</span>
              </span>
            </li>
          </ol>
        </div>
      </div>
    </Card>
  );
}
