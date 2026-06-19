# PROG-34 — Google Auth cutover runbook (`progress.bck.dev`)

A one-time, owner-side runbook to take the in-app Google authentication (PROG-34,
DECISIONS D42) live and move the app to the custom domain **`progress.bck.dev`**.
This supplements `SETUP.md §6`; do the steps in order — the deployed Worker 401s
the API without a cookie/token, and any leftover Cloudflare Access app would
block the new bearer-token automation.

> The Worker derives its OAuth `redirect_uri` from the request origin, so once it
> answers on `progress.bck.dev` the callback URL is automatically
> `https://progress.bck.dev/api/auth/callback`. **Leave `APP_BASE_URL` unset.**

---

## Prerequisite — `bck.dev` is a Cloudflare zone on the same account as the Worker

A Worker Custom Domain can only attach to a zone Cloudflare manages, in the same
account as the `progress` Worker.

- **Already active in this account** → skip to Part A.
- **Not yet:** Cloudflare dashboard → **Add a site** → `bck.dev` → choose a plan
  (Free is fine) → set the two nameservers Cloudflare gives you at your registrar
  → wait until the zone shows **Active**.

---

## Part A — Cloudflare: point `progress.bck.dev` at the Worker

The Custom Domain flow creates the DNS record **and** the TLS cert for you — do
not add a DNS record by hand.

1. Dashboard → **Workers & Pages** → open the **`progress`** Worker.
2. **Settings** → **Domains & Routes** (older UI: **Triggers → Custom Domains**).
3. **Add → Custom Domain** → `progress.bck.dev` → **Add Domain**.
4. Wait until it shows **Active** (cert provisioned — usually under a minute).
5. *(Optional)* In the same panel, **disable the `*.workers.dev` route** so the
   app only answers at `progress.bck.dev`. Leave it on if you want the old URL to
   keep working during transition.

**Access teardown:** the old Cloudflare Access apps were attached to the
`workers.dev` hostname. Ensure **no** Zero Trust → Access application covers
`progress.bck.dev` (we want the app to do its own auth), then delete the two old
**"Progress"** / **"Progress webhook bypass"** applications and the
**`progress-agent`** service token.

---

## Part B — Google: create the OAuth client

1. **Google Cloud Console** → **APIs & Services**. Create or select a project
   (e.g. "Progress").
2. **OAuth consent screen:**
   - **User type: External** (use **Internal** only if `bck.dev` is a Google
     Workspace org containing every signer-in).
   - App name `Progress`, your email as support + developer contact.
   - **Scopes:** keep defaults — we use only `openid`, `email`, `profile`, which
     are **non-sensitive**, so **no Google verification is required**.
   - **Publishing status:** **Publish to production** (simplest; non-sensitive
     scopes need no review), *or* leave in **Testing** and add
     `bryan@mysteryexperience.com` as a **Test user**.
3. **Credentials → Create Credentials → OAuth client ID:**
   - **Application type:** Web application
   - **Name:** `Progress`
   - **Authorized JavaScript origins:** `https://progress.bck.dev` *(optional)*
   - **Authorized redirect URIs** (the critical field):
     - `https://progress.bck.dev/api/auth/callback`
     - *(optional, for local testing)* `http://localhost:8000/api/auth/callback`
   - **Create** → copy the **Client ID** and **Client secret**.

---

## Part C — wire secrets and deploy

From the repo (on `iss/PROG-34`):

```bash
wrangler secret put GOOGLE_CLIENT_ID        # from Part B
wrangler secret put GOOGLE_CLIENT_SECRET    # from Part B
wrangler secret put SESSION_SECRET          # any long random string
wrangler secret put PROGRESS_API_TOKEN      # any long random string (automation bearer)
wrangler secret put ALLOWED_EMAILS          # bryan@mysteryexperience.com

bunx wrangler d1 migrations apply progress-db --remote   # applies 0004_owner_email.sql
bun run deploy
```

Then:

- Delete the old Access apps + `progress-agent` token (Part A).
- Put the live token in local `.env` as `PROD_PROGRESS_API_TOKEN`.
- If the GitHub webhook is registered, update its payload URL to
  `https://progress.bck.dev/api/webhooks/github`.

---

## Part D — code/docs follow-up (domain references)

The Worker is origin-derived and needs no change, but the **automation clients
and docs** still default to the old `progress.bryan-22c.workers.dev`. Update
these to `progress.bck.dev` so MCP / `progress work` / dogfood scripts work
without everyone setting `PROGRESS_BASE_URL`:

- `src/mcp/server.ts`, `bin/progress.ts` — default `PROGRESS_BASE_URL`
- `scripts/dogfood-cutover.ts`, `scripts/dogfood-status.ts`, `scripts/dogfood-v2.ts` — hardcoded `BASE`
- `docs/SETUP.md`, `docs/REFERENCE.md` — `progress.bryan-22c.workers.dev` references

(Until then, point automation at the new host with
`PROGRESS_BASE_URL=https://progress.bck.dev`.)

---

## Verify

```bash
curl https://progress.bck.dev/api/health            # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" \
  https://progress.bck.dev/api/workspace            # 401 (no auth)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $PROGRESS_API_TOKEN" \
  https://progress.bck.dev/api/workspace            # 200
```

Then open `https://progress.bck.dev` in a browser → it bounces to Google →
returns signed in. A Google account not on `ALLOWED_EMAILS` gets **403 not
authorized**.
