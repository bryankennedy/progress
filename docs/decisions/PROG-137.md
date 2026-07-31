### PROG-137 — PostHog web analytics via a first-party Worker proxy, key baked in at build time

**Context.** The v05.3 robustness arc calls for observability. Errors and logs
are covered (Sentry PROG-60/D46, structured Workers Logs), but there was no
view of *usage* — the owner wanted basic web analytics (visitors, paths,
devices) for personal/family use, with a PostHog project already created and
Web Analytics enabled.

**Decision.** Wire `posthog-js` in the client for pageview/pageleave capture
only, and route all SDK traffic through a same-origin reverse proxy at `/ph/*`
in the Worker instead of straight to PostHog Cloud.

- **Proxy, not direct.** The SPA's CSP is `connect-src 'self'` (PROG-65) and
  the proxy keeps it that way — the alternative was whitelisting
  `us.i.posthog.com` for one vendor. It also makes the traffic first-party, so
  content blockers on family devices (which commonly blocklist
  `*.posthog.com`) don't silently zero out the stats. On Workers the proxy is
  ~30 lines (`src/worker/posthog.ts`): `/ph/static/*` → the assets host,
  everything else → the ingestion host, `Cookie` header stripped so the Google
  session token never reaches a third party. `/ph/*` joins `/api/*` in
  `run_worker_first` and sits deliberately outside the auth gate — pageviews
  begin on the sign-in page, before a session exists.
- **Build-time key, CI-supplied, absent = off.** The PostHog project API key
  is a public browser token, but it still lives in env, not source
  (zero-leak rule): Vite bakes `VITE_POSTHOG_KEY` into the bundle, the CI
  deploy job exports it from an Actions secret, and `initAnalytics()`
  no-ops when the key is missing or in dev mode — the same "unset means
  silent" shape as `SENTRY_DSN`. No runtime config fetch: a config endpoint
  would add a request to every load for a value that changes never
  (SPEC §2.1, instant UI).
- **Pageviews only, anonymous only.** `defaults: "2025-05-24"` gives SPA
  history-change pageviews + pageleave (bounce/duration); autocapture is off —
  click-level capture on a tool that is entirely clicks is noise, and Web
  Analytics doesn't need it. `person_profiles: "identified_only"` with no
  `identify()` call keeps everything anonymous events; per-family-member
  attribution is a deliberate non-goal for now. `capture_exceptions` is off —
  Sentry owns errors (D46).
- **Region is hardcoded US Cloud** in the proxy hosts + `ui_host`, with a
  comment marking the two files to touch for EU. An env var for a value that
  changes at most once wasn't worth the indirection.

Setup steps live in `docs/SETUP.md` §6; as-built summary in
`docs/REFERENCE.md` § Observability.
