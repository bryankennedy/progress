### PROG-65 — Security headers, verified-email gate, gitUrl scheme check

A security/production-readiness review (PROG-65) found the code-side posture
strong — fail-closed auth, constant-time token/HMAC compares, parameterized
queries, `react-markdown` with no raw HTML, own-origin-only image resize, no
secrets in the repo or git history — and surfaced a small set of hardening gaps.
The public repo was confirmed clean of secrets (only the owner's own
name/emails/domains appear, an intentional develop-in-public choice).

**Decisions:**

- **Security headers ship in two complementary layers.** The Worker only runs
  for `/api/*` (`run_worker_first`), so it cannot add headers to the
  statically-served SPA document/JS/CSS/fonts. Those get a **`public/_headers`**
  file (Cloudflare static-assets convention; Vite copies it to the asset root)
  carrying a **CSP** plus HSTS, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, and `Permissions-Policy`. A Worker `app.use("*")` middleware
  sets nosniff / frame-deny / no-referrer / HSTS on everything *it* serves — the
  `/api/*` JSON, the image blobs, and the not-authorized page.
- **CSP is tuned to exactly what the built `index.html` loads**, not a generic
  template, and verified in a real browser (zero `securitypolicyviolation`
  events; fonts + inline `style` attributes + dnd-kit `.style.transform` all
  pass). `style-src` needs `'unsafe-inline'` because React `style={}` and
  dnd-kit drag transforms write inline styles; `script-src 'self'` is clean (the
  Vite build emits no inline scripts). CSP is deliberately **not** set by the
  Worker middleware: the not-authorized page uses inline `<style>` + Google
  Fonts, and the JSON API needs none.
- **`X-Content-Type-Options: nosniff` matters most for `/api/images`**, whose
  stored `Content-Type` is client-asserted and not magic-byte-checked — nosniff
  stops a browser from sniffing a mislabeled upload into something executable.
- **The OAuth callback now requires a Google-`verified` email** before the
  allowlist is consulted — defense-in-depth so an allowlist entry can never be
  satisfied by an unverified address. The allowlist (D44) remains the real gate.
- **`gitUrl` is validated server-side as an `http(s)` URL** on `POST`/`PATCH
  /api/repos`. The client renders it as a clickable link, so a `javascript:`
  (or `data:`) value would be a stored XSS vector on click.
- **The single-tenant trust model is affirmed, not changed.** Any allowlisted
  user (or the bearer token) can read all workspace data and all images; there
  is intentionally no per-resource ownership check, because every allowlisted
  account is trusted. Documented in REFERENCE so it reads as a decision, not a
  gap.
- **Vulnerability disclosure is published** as a repo-root `SECURITY.md` and an
  RFC 9116 `public/.well-known/security.txt` (canonical `https://progress.bck.dev`,
  served at `/.well-known/security.txt`). Low cost, and a fitting maturity signal
  for a develop-in-public portfolio repo whose public surface is the OAuth flow +
  webhook + health probe even though the app is allowlisted. The `security.txt`
  `Expires` field is mandatory and set ~1 year out (2027-07-01); it must be
  renewed before lapsing, since an expired file is worse than none.

*Deferred:* app-level rate limiting — the unauthenticated surface is minimal
(OAuth callback rejects on signed-state before any work; the webhook is
HMAC-gated; uploads are authenticated) and Cloudflare provides platform DDoS
protection, so this is defense-in-depth rather than a live risk.
