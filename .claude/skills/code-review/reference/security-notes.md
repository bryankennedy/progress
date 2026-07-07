# Security pre-flight (light)

A fast pass, not a security review — dedicated scanners and the periodic
security audit own the deep checks. Deployment context: Cloudflare Access +
service token in front of a single-user Worker, so the exposure is smaller
than a public multi-tenant app — but "the proxy protects us" is not an excuse
for holes at the app layer.

## Secrets in source or logs

- Any literal that looks like a credential (API key, token, webhook secret) in
  code, config, tests, or fixtures: **blocking**. Secrets come from env only —
  `.env` locally (gitignored), `wrangler secret` in prod, `c.env.*` in the
  worker.
- Logging whole request headers/bodies on auth paths leaks tokens into
  Cloudflare logs/Sentry:

```ts
// Before
log("auth failed", { headers: Object.fromEntries(c.req.raw.headers) });
// After
log("auth failed", { path: c.req.path, hasToken: c.req.header("authorization") !== undefined });
```

- New env keys must appear in `.env.example` with a dummy value (repo rule).

## Input validation at boundaries

Covered in depth in `reference/error-and-async.md`; the security angle:

- Request-derived values reaching a query must go through Drizzle's builder or
  bound `sql` params — never string-built SQL (see `reference/data-layer.md`).
- IDs/keys from the URL: validate shape before use; don't pass raw path
  segments into filesystem-like or key-composed lookups (R2 object keys built
  from user input need an allowlisted shape, or a stored id, not a path echo).
- Auth checks live in middleware, once — a new route added outside the
  auth-gated group is `blocking`.

## Output encoding / XSS

React escapes by default; the escape hatches are the findings:

- `dangerouslySetInnerHTML` with anything other than a compile-time constant:
  **blocking** unless sanitized by a real sanitizer.
- Markdown rendering: `react-markdown` without `rehype-raw` does not render
  raw HTML — keep it that way; adding raw-HTML support to user-editable
  markdown is `blocking` without sanitization.
- URLs from data (`href={action.url}`): check for `javascript:` scheme when the
  value can be user-supplied; constrain to `http(s)`.

## SSRF on outbound fetches

Any worker-side `fetch` to a URL influenced by request data can be aimed at
internal targets:

```ts
// Before — caller controls the host
const res = await fetch(body.repoUrl);
// After — compose the URL from an allowlisted base + validated parts
const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, ...);
```

GitHub API calls should be built from validated `owner/repo` slugs, never a
client-supplied URL. Webhook handlers must verify the signature
(`X-Hub-Signature-256`, constant-time compare) before trusting the payload.

## Severity guide

Secrets and injection: `blocking`. Missing signature verification: `blocking`.
Header/body over-logging: `important`. Scheme checks on rendered URLs:
`important` where user-editable, `suggestion` where owner-only.
