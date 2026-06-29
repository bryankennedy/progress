// Unauthenticated landing page (PROG-34). Shown when the workspace load returns
// 401 (no session cookie / bearer). It is the only screen rendered without a
// workspace, so it carries no Header and reaches for nothing in the store — just
// the brand mark and a single CTA that hands off to the Google OAuth flow.
//
// The button is a plain link to `/api/auth/login`: a full-page navigation that
// 302s to Google, then back through `/api/auth/callback` (which sets the session
// cookie and returns to `/`). No JS, no fetch — nothing to get optimistic about.

export default function SignIn() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 text-ink">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <img
          src="/brand-assets/progress-icon.svg"
          alt="Progress"
          width={88}
          height={88}
          className="rounded-2xl shadow-sm"
        />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Progress</h1>
        <p className="mt-2 text-sm text-ink-soft">Sign in to continue.</p>

        <a
          href="/api/auth/login"
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-md bg-adobe px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-adobe-deep"
        >
          <GoogleMark />
          Sign in with Google
        </a>
      </div>
    </div>
  );
}

// Google's "G" mark, inlined so the page needs no extra asset request.
function GoogleMark() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
      <path
        fill="#fff"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
        opacity={0.95}
      />
      <path
        fill="#fff"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
        opacity={0.85}
      />
      <path
        fill="#fff"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33Z"
        opacity={0.7}
      />
      <path
        fill="#fff"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
        opacity={0.85}
      />
    </svg>
  );
}
