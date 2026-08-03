### csp-allow-web-analytics — CSP admits the Cloudflare Web Analytics beacon; Bot Fight Mode inline script stays blocked

**Date:** 2026-07-17

**Context.** The `bck.dev` zone edge-injects two scripts into the served HTML:
the Web Analytics (RUM) beacon (`static.cloudflareinsights.com/beacon.min.js`)
and Bot Fight Mode's inline challenge bootstrap. The PROG-65 CSP
(`script-src 'self'` in `public/_headers`) blocked both, producing console
errors on every page load and silently disabling Web Analytics.

**Decision.** The owner wants Web Analytics, so the CSP now allows exactly what
the beacon needs: `https://static.cloudflareinsights.com` in `script-src` and
`https://cloudflareinsights.com` in `connect-src` (RUM POST target). This
supersedes PROG-65's "script-src is 'self' only" line; the rest of that policy
stands.

**Not allowed.** The Bot Fight Mode inline script embeds a per-response
timestamp, so no static hash matches it and a `_headers` file can't mint
nonces — admitting it would require `'unsafe-inline'`, which guts the policy.
Its console error is cosmetic; if it grates, the fix is zone-side (disable Bot
Fight Mode or its JavaScript Detections), not CSP-side.
