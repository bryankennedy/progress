// Same-origin reverse proxy for PostHog (PROG-137). The client SDK posts to
// `/ph/*` on our own origin and this forwards to PostHog Cloud, because:
//   - the SPA's CSP is `connect-src 'self'` (public/_headers) and we'd rather
//     keep it that way than open a third-party host;
//   - content blockers commonly blocklist *.posthog.com, and family devices
//     run them — first-party traffic survives.
// PostHog's documented Workers-proxy shape: `/static/*` (lazily-loaded SDK
// bundles) comes from the assets host, everything else (event capture, remote
// config) from the ingestion host.

// US Cloud. On EU Cloud these would be eu.i.posthog.com / eu-assets.i.posthog.com
// (and ui_host in src/client/analytics.ts would be eu.posthog.com).
const INGEST_HOST = "us.i.posthog.com";
const ASSETS_HOST = "us-assets.i.posthog.com";

export const POSTHOG_PROXY_PREFIX = "/ph";

// Map an incoming `/ph/...` request URL to its PostHog upstream. Pure so the
// routing is unit-testable without a fetch.
export function posthogUpstreamUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  const path = url.pathname.slice(POSTHOG_PROXY_PREFIX.length) || "/";
  const host = path.startsWith("/static/") ? ASSETS_HOST : INGEST_HOST;
  return `https://${host}${path}${url.search}`;
}

// Forward the request wholesale, minus anything that identifies the session:
// the Google session cookie must never leave our origin.
export async function proxyPosthog(req: Request): Promise<Response> {
  const upstream = posthogUpstreamUrl(req.url);
  const headers = new Headers(req.headers);
  headers.delete("cookie");
  headers.set("host", new URL(upstream).hostname);
  const res = await fetch(upstream, {
    method: req.method,
    headers,
    body: req.body,
  });
  // fetch() responses are immutable on Workers; re-wrap so the security-header
  // middleware (src/worker/index.ts) can set headers on the way out.
  return new Response(res.body, res);
}
