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
| `drizzle/` | Generated SQL migrations (committed) |
| `scripts/seed.sql` | Idempotent seed data (`seed-scale.ts`: 5k-issue synthetic workspace) |
| `wrangler.jsonc` | Worker config: D1 binding, SPA assets, `/api/*` routing |
| `vite.config.ts` | Vite + React + Tailwind + Cloudflare plugins |

## 6. Production deploy

Deployed 2026-06-12: <https://progress.bryan-22c.workers.dev> (single
Worker; D1 `progress-db` in ENAM, id in `wrangler.jsonc` — local dev
ignores it). Migrations + the idempotent dogfood seed are applied;
`GITHUB_WEBHOOK_SECRET` is set via `wrangler secret put` (the value also
lives in the local gitignored `.env` as `PROD_GITHUB_WEBHOOK_SECRET`, for
GitHub-side registration).

Redeploy after changes: `bun run deploy` (builds, then `wrangler deploy`).
Schema changes additionally need
`bunx wrangler d1 migrations apply progress-db --remote` first.

**Cloudflare Access is live** (configured 2026-06-12, SPEC §8.3): two
self-hosted Zero Trust applications — "Progress" on the bare hostname with
an Allow policy for the owner's email (One-time PIN login, team domain
`purple-flower-89f4.cloudflareaccess.com`), and "Progress webhook bypass"
on path `api/webhooks/github` with a Bypass · Everyone policy (the route
authenticates via HMAC instead). Verified: `/` and `/api/*` 302 to the
Access login; the webhook path reaches the Worker (401 unsigned, 200
signed). Note: a Zero Trust app on a workers.dev hostname only enforces
once its policy is actually attached — an app saved without one blocks
nothing.

Remaining one-time setup (owner-only): **GitHub webhook** per connected
repository: Settings → Webhooks → Add — payload URL
`https://progress.bryan-22c.workers.dev/api/webhooks/github`, content type
`application/json`, secret = `PROD_GITHUB_WEBHOOK_SECRET` from `.env`,
events: Pushes + Pull requests.
