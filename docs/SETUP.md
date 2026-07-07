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
| `bun run format` | Format the repo with Prettier (writes files) |
| `bun run format:check` | Verify formatting without writing — same gate CI runs |
| `bun run build` | Production build to `dist/` |
| `bun run db:generate` | Generate a SQL migration from `src/db/schema.ts` changes |
| `bun run db:migrate` | Apply pending migrations to local D1 |
| `bun run db:seed` | Seed baseline data (idempotent) |
| `bun run db:seed:scale` | Add a deterministic 5k-action synthetic dataset (perf testing) |

### Formatting

Prettier is the single source of style truth — config lives in `.prettierrc`
at the repo root (printWidth 100; everything else is Prettier defaults, which
match the codebase's hand-written style: double quotes, semicolons, trailing
commas). `.prettierignore` excludes generated files (`drizzle/`, `bun.lock`)
and **all Markdown** — docs tables and emphasis are hand-formatted, and
Prettier's table re-padding would produce whitespace-only diffs (see
`docs/decisions/prettier-adoption.md`).

- `bun run format` before committing (or rely on editor format-on-save).
- CI runs `bun run format:check` as the first gate — unformatted code fails
  the build before typecheck/tests run.
- Zed picks up `.prettierrc` automatically; `.zed/settings.json` (committed)
  pins the formatter and turns format-on-save off for Markdown so the editor
  agrees with CI.

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
| `scripts/seed.sql` | Idempotent seed data (`seed-scale.ts`: 5k-action synthetic dataset) |
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

**Image uploads (PROG-42)** use an R2 bucket bound as `IMAGES`. Local dev gets a
Miniflare bucket automatically; production needs a one-time
`wrangler r2 bucket create progress-images`. For the `?w=` display variants to
actually resize, enable **Transformations / Image Resizing** on the `bck.dev`
zone (Cloudflare dashboard → Images → Transformations); until then the worker
streams the original bytes (everything still works, just unresized).

Redeploy after changes: `bun run deploy` (builds, then `wrangler deploy`).
Schema changes additionally need
`bunx wrangler d1 migrations apply progress-db --remote` first. This is the
**break-glass** path — day to day, deploys are automatic (below).

### Continuous deployment (PROG-54)

Pushing to `main` auto-deploys via GitHub Actions (`.github/workflows/ci.yml`).
The workflow has two jobs: **`test`** (`bun run check` + `bun test src`) runs on
every PR and on the main push; **`deploy`** runs only after `test` is green on a
push to `main`, applies any pending D1 migrations
(`wrangler d1 migrations apply progress-db --remote`), then `bun run deploy`s.
Migrations are auto-applied so code and schema stay in lockstep; the recovery
axes below are unchanged. `wrangler deploy` never touches `wrangler secret`s, so
prod `GITHUB_WEBHOOK_SECRET` survives every deploy.

One-time setup (owner, outside the repo):

- **Repo secrets** (Settings → Secrets and variables → Actions):
  `CLOUDFLARE_API_TOKEN` (the *Edit Cloudflare Workers* token template **plus**
  Account › D1 : Edit) and `CLOUDFLARE_ACCOUNT_ID` (from `bunx wrangler whoami`).
- **Branch protection** for `main` (Settings → Branches): require a PR, require
  the **`test`** status check to pass, require branches up to date, block force
  pushes and deletion. (Solo repo: skip "require approvals" or add yourself as a
  bypass — you can't approve your own PR.)

Manual `bun run deploy` from a logged-in machine still works as the break-glass
path if Actions is unavailable.

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

1. **External uptime monitor — Better Stack (set up, PROG-47).** The live monitor
   polls `https://progress.bck.dev/api/health` every 180 s from US + EU and emails
   `bryan@mysteryexperience.com` on failure. Because the endpoint round-trips D1
   (#5), a `503` means the database is unreachable — a true end-to-end health
   signal, not just "the Worker booted". This is the primary alert. The monitor is
   **config as code**: `scripts/monitors.ts` declares it and `bun run
   monitors:sync` creates-or-updates it idempotently against the Better Stack
   Uptime API using `BETTERSTACK_API_TOKEN` from `.env`; add another app by
   appending to the `MONITORS` array and re-running. Better Stack is the
   general-purpose alerting layer for the stack (DECISIONS PROG-47) — its free
   tier also covers cron/heartbeat monitors and a status page when wanted.
   *One-time account setup:* sign in to Better Stack, create an **Uptime API
   token** (Settings → API tokens → Team-based), put it in `.env` as
   `BETTERSTACK_API_TOKEN`, then run the sync.
2. **Cloudflare Health Checks (unused alternative).** Zone-level under the
   `bck.dev` zone → *Traffic → Health Checks* (not account Notifications), an
   HTTPS check on `/api/health` expecting `200`, exposing a *Health Check Status
   Notification* type. Not used — it's the wrong layer for a Worker (it monitors
   origins behind the proxy) and standalone Health Checks can be a paid add-on;
   the Better Stack monitor above covers the need without that dependency.

Error **visibility** (the forensic trail once a monitor flags an outage) needs no
alert setup — it's the structured logs above: Workers & Pages → `progress` →
Logs, filter `event = unhandled_error`.

#### Error tracking — Sentry (PROG-60, D46)

Workers Logs is the searchable record; **Sentry** is the *alert-and-triage* layer
it lacks — it groups exceptions, keeps full stack traces (30-day retention on the
free tier vs Logs' 3 days), and emails on the first occurrence of a new error
type, which is precisely the uncaught-exception alert Cloudflare's Notifications
catalog doesn't offer. The Worker is wired via `@sentry/cloudflare`: the default
export is wrapped in `Sentry.withSentry(...)` and `app.onError` calls
`Sentry.captureException(err, { tags: { requestId } })`, so every Sentry issue
cross-links to the matching Workers Logs line by `requestId`. The SDK needs the
`nodejs_compat` flag (set in `wrangler.jsonc`). It only sends when `SENTRY_DSN` is
set — **no DSN means a silent no-op**, so local dev and tests never report.
Tracing is off (`tracesSampleRate: 0`): error events only, to stay inside the
free tier.

One-time account setup (owner):

1. Create a free account at <https://sentry.io> (Developer plan: 5k errors/mo,
   30-day retention — ample for this app).
2. **Create project** → platform **Cloudflare Workers** → name it `progress`.
3. Copy the project **DSN** (Project → Settings → **Client Keys (DSN)**). It's a
   URL like `https://<key>@o<org>.ingest.sentry.io/<project>`; not a hard secret,
   but treat it as one.
4. Set it as a production Worker secret: `bunx wrangler secret put SENTRY_DSN`
   (paste the DSN). Leave it **unset locally** — keep the `.dev.vars` line blank
   so dev stays silent. (It's documented in `.env.example`.)
5. *(Optional)* Alerts → confirm the default "A new issue is created" rule mails
   `bryan@mysteryexperience.com`; add a rate rule (e.g. >N events/hour) if wanted.
6. Verify after the next deploy: temporarily hit a route that throws (or check the
   first real 500) → the issue appears in Sentry with the `requestId` tag, and the
   same `requestId` finds the `unhandled_error` line in Workers Logs.

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

Self-check after cutover: `GET /api/snapshot` returns 401 with no auth, 200
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
tools (`get_bundle`, `get_action`, `list_actions`, `create_action`,
`update_status`, `set_due_date`, `comment`, `move_action`). It is a **local
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
fetches the action's bundle, creates/checks out `act/<KEY>` (so commits/PRs
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
