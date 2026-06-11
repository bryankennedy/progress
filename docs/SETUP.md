# Setup & Development

Repeatable steps to get Progress running from a fresh checkout. Verified on
Ubuntu 24.04 (the exe.dev VM), 2026-06-11.

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
| `src/client/` | React app (entry: `main.tsx`) |
| `src/db/schema.ts` | Drizzle schema — generates migrations |
| `drizzle/` | Generated SQL migrations (committed) |
| `scripts/seed.sql` | Idempotent seed data |
| `wrangler.jsonc` | Worker config: D1 binding, SPA assets, `/api/*` routing |
| `vite.config.ts` | Vite + React + Tailwind + Cloudflare plugins |

## 6. Production deploy

Not set up yet (comes with the deploy milestone). It will be:
`wrangler login` → create the real D1 database and put its id in
`wrangler.jsonc` → `bun run deploy` → put Cloudflare Access in front
(SPEC §8.3). The `database_id` currently in `wrangler.jsonc` is a placeholder;
local dev ignores it.
