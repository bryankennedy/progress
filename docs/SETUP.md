# Setup & Development

How-to guide: get Progress running from a fresh checkout and make everyday
changes. Verified on Ubuntu 24.04 (the exe.dev VM), 2026-06-12. For what the
system does, see [`REFERENCE.md`](./REFERENCE.md); for the doc map, see
[`README.md`](./README.md).

## 1. Prerequisites

Two runtimes (see CLAUDE.md conventions: Bun for packages/scripts, Node LTS
underneath for tooling that expects it):

```sh
# Bun (installs to ~/.bun/bin, added to PATH via ~/.bashrc)
curl -fsSL https://bun.sh/install | bash

# Node 22 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## 2. Install & database

```sh
bun install        # dependencies (bun.lock is committed)
bun run db:migrate # apply drizzle/ migrations to the local D1 (.wrangler/state/)
bun run db:seed    # idempotent: inserts the single owner user
```

The local database is Miniflare's SQLite under `.wrangler/state/` — gitignored,
safe to delete; re-run migrate + seed to rebuild.

### Worker secrets (webhook)

The GitHub webhook route needs `GITHUB_WEBHOOK_SECRET`. Worker bindings read
local secrets from `.dev.vars` (gitignored):

```sh
cp .env.example .dev.vars   # then fill in a value
```

Restart the dev server after changing `.dev.vars`. Without it the webhook
route answers 503 and everything else works normally. To exercise the route
locally, send a payload signed with the same secret
(`sha256=` + HMAC-SHA-256 of the raw body in `X-Hub-Signature-256`).

## 3. Run the dev server

```sh
bun run dev
```

One Vite dev server (port 8000) runs everything: the React client **and** the
Hono Worker with its D1 binding, via `@cloudflare/vite-plugin`. There is no
separate API process. Port 8000 is the exe.dev proxy's default public port, so
the dev server is served directly at the VM's main URL — no nginx in between.

- Locally: <http://localhost:8000/>
- Through the exe.dev proxy: <https://progress.exe.xyz/> — requires an exe.dev
  login with access to this VM. Note: `curl`ing the proxy URL from inside the
  VM fails (proxy auth is browser-session-based); test locally against
  `localhost:8000` instead.

## 4. Everyday commands

| Command | What it does |
|---|---|
| `bun run dev` | Dev server (client + worker + local D1) |
| `bun run check` | Type-check all tsconfig project references |
| `bun run test` | Unit tests (`bun test`, scoped to `src/`) — e.g. the board-rank helper |
| `bun run test:e2e` | Browser e2e (Playwright) — board drag-and-drop. One-time: `bunx playwright install chromium`. Boots a dev server if none is running |
| `bun run build` | Production build to `dist/` |
| `bun run db:generate` | Generate a SQL migration from `src/db/schema.ts` changes |
| `bun run db:migrate` | Apply pending migrations to local D1 |
| `bun run db:seed` | Seed baseline data (idempotent) |
| `bun run db:seed:scale` | Add a deterministic 5k-issue synthetic workspace (perf testing) |

### Schema-change workflow

1. Edit `src/db/schema.ts` (Drizzle schema — single source of truth).
2. `bun run db:generate` → writes a numbered SQL file into `drizzle/` (commit it).
3. `bun run db:migrate` → applies it locally. Wrangler tracks applied
   migrations in a `d1_migrations` table, so this is always safe to re-run.

## 5. Project layout

| Path | Purpose |
|---|---|
| `src/worker/` | Hono API (Cloudflare Worker entry: `index.ts`) |
| `src/client/` | React app (entry: `main.tsx`; `pages/`, `commands/` for palette/dialogs/keyboard, `store.ts` for all mutations) |
| `src/shared/` | Wire types + fixed vocabularies, shared client/server (dependency-free) |
| `src/db/schema.ts` | Drizzle schema — generates migrations |
| `src/mcp/server.ts` | Progress MCP server (`bun run mcp`) — stdio client of the API (§7) |
| `bin/progress.ts` | `progress work <KEY>` kickoff CLI (§7) |
| `drizzle/` | Generated SQL migrations (committed) |
| `scripts/seed.sql` | Idempotent seed data (`seed-scale.ts`: 5k-issue synthetic workspace) |
| `wrangler.jsonc` | Worker config: D1 binding, SPA assets, `/api/*` routing |
| `vite.config.ts` | Vite + React + Tailwind + Cloudflare plugins |

## 6. Production deploy

Live at <https://progress.bck.dev> (the canonical host; the original
`progress.bryan-22c.workers.dev` workers.dev URL still resolves). First
deployed 2026-06-12 — single Worker; D1 `progress-db` in ENAM, id in
`wrangler.jsonc` — local dev ignores it. Migrations + the idempotent
dogfood seed are applied;
`GITHUB_WEBHOOK_SECRET` is set via `wrangler secret put` (the value also
lives in the local gitignored `.env` as `PROD_GITHUB_WEBHOOK_SECRET`, for
GitHub-side registration).

Redeploy after changes: `bun run deploy` (builds, then `wrangler deploy`).
Schema changes additionally need
`bunx wrangler d1 migrations apply progress-db --remote` first.

### Rollback & recovery

Two independent axes — **code** (the Worker artifact) and **data** (the D1
database). Roll back the one that broke; they're decoupled.

**Code — revert to a previous Worker version (no rebuild):**

```sh
bunx wrangler deployments list                 # find the prior version id + timestamp
bunx wrangler rollback [<version-id>]           # omit the id to roll back one deploy
```

`rollback` re-points the live Worker at an already-uploaded version instantly;
it does **not** touch D1. Prefer it for a bad code deploy. To instead roll
*forward* from source, `git revert` the offending commit and `bun run deploy`.
Caveat: a rollback past a deploy that applied a migration leaves older code
running against the newer schema — if the bad deploy included a schema change,
plan the data axis below too.

**Data — D1 time travel (point-in-time restore, ~30-day window):**

```sh
bunx wrangler d1 time-travel info progress-db                 # current restorable window
bunx wrangler d1 time-travel restore progress-db --timestamp=<ISO-8601>
# or restore to a specific transaction:
bunx wrangler d1 time-travel restore progress-db --bookmark=<bookmark>
```

Restore is **destructive and in-place** — it rewinds `progress-db` to that point
and discards everything after, so capture the current state first
(`bunx wrangler d1 export progress-db --remote --output=pre-restore.sql`) and,
where possible, grab a `--bookmark` *before* the bad write so you can pin the
exact transaction. Restore is the whole database, not a single table.

This recovery path is documented but **unexercised in production** — see the
open readiness item to run a real time-travel restore drill (e.g. against a
throwaway D1) and confirm the steps before an incident forces them.

### Observability & alerts

The Worker emits **structured JSON logs** (`src/worker/log.ts`) — one line per
event, every field filterable. A top-level middleware tags each request with a
`requestId` (Cloudflare's `cf-ray` in prod, a uuid locally), echoes it as the
`x-request-id` response header, and logs a `request` access line
(`method`/`path`/`status`/`durationMs`) on completion. Any error logged while
serving that request (`unhandled_error`, `oauth_callback_failed`,
`health_d1_probe_failed`) carries the same `requestId`, so a failure traces end
to end. Health-check polling is deliberately not access-logged.

Logs are retained and queryable in the dashboard because `observability` is
enabled in `wrangler.jsonc`. To view them:

- **Live tail:** `bunx wrangler tail` (add `--format=pretty`, or
  `--status=error` to watch only failures).
- **Dashboard:** Workers & Pages → `progress` → **Logs** (a.k.a. Workers
  Observability). Filter by field, e.g. `event = unhandled_error` or
  `requestId = <the x-request-id a user reported>`.

**Alerting** (one-time, owner task). Note Cloudflare's account-level
**Notifications** catalog has **no generic Workers error-rate / uncaught-exception
alert** — don't go looking for a "Workers → Script errors" type; it isn't there.
The reliable signal comes from the readiness endpoint instead:

1. **External uptime monitor (recommended, plan-independent).** Point any
   uptime service (UptimeRobot / Better Stack / Healthchecks.io free tier) at
   `https://progress.bck.dev/api/health`, expect HTTP `200`, alert on failure to
   `bryan@mysteryexperience.com`. Because the endpoint round-trips D1 (#5), a
   `503` means the database is unreachable — a true end-to-end health signal, not
   just "the Worker booted". This is the primary alert.
2. **Cloudflare Health Checks (only if available on the plan).** Zone-level under
   the `bck.dev` zone → *Traffic → Health Checks* (not account Notifications), an
   HTTPS check on `/api/health` expecting `200`; it then exposes a *Health Check
   Status Notification* type. Standalone Health Checks can be a paid add-on, so
   this may be absent — the external monitor above covers the same need without
   that dependency.

Error **visibility** (the forensic trail once a monitor flags an outage) needs no
alert setup — it's the structured logs above: Workers & Pages → `progress` →
Logs, filter `event = unhandled_error`.

**v2 shipped 2026-06-17** (migration `0003_breezy_spot.sql` — the nullable
`issues.due_date`): due dates, the Agenda view, the Structure route, and the
header New menu. The remote migration + `bun run deploy` were applied; the build
was recorded in production via `bun --env-file=.env scripts/dogfood-v2.ts`
(idempotent, like the cutover script) under the **v2 — Broaden & Due dates** arc.

### Authentication — in-app Google sign-in (PROG-34, supersedes Cloudflare Access)

The Worker owns auth itself: it runs the Google OAuth flow, mints a signed
session cookie, and attributes every write to the signed-in user (D12 — the
Cloudflare Access gate — is retired; see DECISIONS). Identity comes from a
session cookie (interactive) or a bearer token (automation); the GitHub webhook
keeps its own HMAC. When the OAuth secrets are absent (local dev) the Worker
falls back to the owner so `bun run dev` never hits a login wall.

**Worker secrets** (`wrangler secret put <KEY>`; local equivalents in `.dev.vars`):

| Secret | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Web client |
| `SESSION_SECRET` | HS256 key signing the session + OAuth-state cookies |
| `PROGRESS_API_TOKEN` | bearer for non-interactive clients (→ owner) |
| `SUPER_ADMIN_EMAILS` | comma-separated super-admins (currently `bryan@mysteryexperience.com`): manage the allowlist on the Admin page, always allowed. Everyone else is added via that page (stored in D1). Old name `ALLOWED_EMAILS` is read as a fallback (D44) |

**Google OAuth client**: Google Cloud Console → APIs & Services → Credentials →
**Create OAuth client ID** → *Web application*. Authorized redirect URIs:
`https://progress.bck.dev/api/auth/callback` (and
`http://localhost:8000/api/auth/callback` to test locally). Copy the client
id/secret into the secrets above.

**Cutover (order matters** — the deployed Worker 401s the API without a
cookie/token, and Access would otherwise block bearer automation):

1. Create the OAuth client and add the redirect URI (above).
2. `wrangler secret put` the secrets; confirm `SUPER_ADMIN_EMAILS` (the renamed
   `ALLOWED_EMAILS` — set the new key, then delete the old one once verified).
3. `bunx wrangler d1 migrations apply progress-db --remote` (applies
   `0004_owner_email.sql`, repointing `usr_owner` to the owner email so
   sign-in resolves to the existing row, preserving attribution).
4. `bun run deploy`.
5. **Remove the Cloudflare Access applications** (Zero Trust → Access →
   Applications: delete "Progress" and "Progress webhook bypass", and the
   `progress-agent` service token) so the app's own auth is the only gate.
6. Put the live `PROGRESS_API_TOKEN` in the gitignored `.env` as
   `PROD_PROGRESS_API_TOKEN`; re-verify the MCP server and `progress work`.

Self-check after cutover: `GET /api/workspace` returns 401 with no auth, 200
with `Authorization: Bearer <PROGRESS_API_TOKEN>`; visiting `/` in a browser
bounces through Google sign-in. (Webhook registration below is unchanged.)

Remaining one-time setup (owner-only): **GitHub webhook** per connected
repository: Settings → Webhooks → Add — payload URL
`https://progress.bck.dev/api/webhooks/github`, content type
`application/json`, secret = `PROD_GITHUB_WEBHOOK_SECRET` from `.env`,
events: Pushes + Pull requests.

## 7. Agent integration (MCP server + work CLI)

### MCP server

`src/mcp/server.ts` (D34) exposes the production API to Claude Code as MCP
tools (`get_bundle`, `get_issue`, `list_issues`, `create_issue`,
`update_status`, `set_due_date`, `comment`, `move_issue`). It is a **local
stdio** server — it
runs on your machine and reaches the API with the `PROGRESS_API_TOKEN` bearer
from §6, so nothing is hosted on the Worker.

Smoke-test it standalone (lists tools, runs the read tools against production):

```bash
bun run mcp   # connects, prints "[progress-mcp] connected to …" on stderr
```

Register it with Claude Code. Use `bun --env-file` so the API token loads
from `.env` regardless of where Claude Code launches the process — the secret
stays in `.env` and never lands in `~/.claude.json`:

```bash
claude mcp add progress -- bun --env-file=/ABS/PATH/TO/progress/.env \
  /ABS/PATH/TO/progress/src/mcp/server.ts
```

Verify with `claude mcp list` (should show `progress` connected) and `/mcp` in a
session (lists the eight tools). Override the target with `PROGRESS_BASE_URL`
(defaults to production) to point the server at a local `bun run dev` instance
instead. Then in any session: *"pull the bundle for PROG-18 and start working"*
— the agent calls `get_bundle`, does the work, and reports back via `comment` /
`update_status` (SPEC §11.3).

### Work CLI (`progress work`)

`bin/progress.ts` (D35) is the outbound counterpart: `progress work <KEY>`
fetches the issue's bundle, creates/checks out `iss/<KEY>` (so commits/PRs
auto-link via §5), and launches `claude` primed with the bundle — in the
current directory, so it carries no machine-specific knowledge of where repos
live. Run it from inside the checkout you want to work in.

Expose it as `progress` with a shell alias that, like the MCP server, loads the
token from `.env` via `--env-file`:

```bash
alias progress='bun --env-file=/ABS/PATH/TO/progress/.env /ABS/PATH/TO/progress/bin/progress.ts'
```

Then `progress work PROG-19` (or `--print` to just emit the bundle, `--no-branch`
to skip the branch). The in-app **Work on this** field / `W` key (REFERENCE §5)
copy this same one-liner, or the bundle Markdown directly as a prompt.
