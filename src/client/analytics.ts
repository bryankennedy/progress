import posthog from "posthog-js";

// Web analytics — PostHog (PROG-137). Pageviews/pageleaves only: enough for
// the Web Analytics dashboard (visitors, paths, referrers, devices) without
// autocapturing every click in a tool whose whole UI is clicks. Events go to
// the same-origin `/ph` Worker proxy (src/worker/posthog.ts), so the CSP's
// `connect-src 'self'` stays intact and content blockers on family devices
// don't eat the requests.
//
// The key is the *public* PostHog project token, baked in at build time by
// Vite (CI passes VITE_POSTHOG_KEY; see .github/workflows/ci.yml). No key —
// every local dev/test build — and this is a no-op, mirroring how a blank
// SENTRY_DSN silences the Worker SDK.
export function initAnalytics() {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key || import.meta.env.DEV) return;
  posthog.init(key, {
    api_host: "/ph",
    // Toolbar/deep-link host only — events never go here. US Cloud; keep in
    // sync with the upstream hosts in src/worker/posthog.ts.
    ui_host: "https://us.posthog.com",
    // 2025-05-24 defaults: SPA pageviews on history changes + pageleave
    // capture (bounce rate / session duration in Web Analytics).
    defaults: "2025-05-24",
    // Anonymous events only until something calls identify() (nothing does) —
    // web-analytics stats don't need person profiles.
    person_profiles: "identified_only",
    autocapture: false,
    // Sentry owns error tracking (PROG-60); don't double-report.
    capture_exceptions: false,
  });
}
