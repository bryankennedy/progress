# Progress

A single-user, web-based product-development tracker (a "personal Linear" with
the owner's own hierarchy: Initiative → Product → Repo/Arc → Issue).

## Documents — read before non-trivial work

Organized per Diátaxis (map: `docs/README.md`). Built vs. planned is split
deliberately — keep it that way as milestones land:

- `docs/REFERENCE.md` — the system **as built** (domain rules, API, client
  architecture, keyboard map). Present tense; update it when shipping.
- `docs/SPEC.md` — vision, principles, and the **not-yet-built** roadmap.
  Source of truth for scope of remaining work. Section numbers are stable
  (code comments cite them); when an area ships, shrink its section to a
  pointer into REFERENCE rather than renumbering.
- `docs/DECISIONS.md` — append-only decision log. Settled questions live here;
  don't re-litigate them — supersede with a new entry if something changes.
- `docs/SETUP.md` — how-to: install, run, schema changes, deploy.

When a decision of consequence is made in conversation, record it in
`docs/DECISIONS.md` in the same session.

## Hard requirements (never trade away)

1. **Instant UI.** Whole workspace loads into a client store; all mutations are
   optimistic; a spinner on user interaction is a bug. See SPEC §8.2.
2. **The owner's nouns.** Initiative, Product, Repo, Arc, Issue. Never "epic",
   never "project" (as an entity name).
3. **Rigid simplicity.** Fixed status set, no configurable workflows.

## Stack & conventions

- Cloudflare Workers + D1 (Drizzle), Hono API, React + Vite + Tailwind.
- Bun for packages and scripts (`bun`/`bunx`, never npm/npx). Node LTS.
- TypeScript strict, ESM (`import`/`export`) everywhere.
- Secrets only via env (`.env` locally — gitignored, `wrangler secret` in
  prod). Keep `.env.example` updated when adding a key.
- One root `.gitignore`; every entry gets a `#` rationale comment.

## Status

**Phase: building.** Milestones 1 (scaffold + walking skeleton) and 2 (domain
schema D17–D19, workspace load endpoint D20, TanStack Query client store D21
with the optimistic-mutation template in `src/client/store.ts`) complete
2026-06-11. Milestone 3 (real views: issue page D22, global "My Work" board
D23, container pages) and milestone 4 (issue creation + movement with key
aliases D24, command palette + keyboard map D25 — `src/client/commands/`)
complete 2026-06-12. Milestone 5 (CRUD gaps, D26–D27: container
create/edit/archive, tags with auto-color, arc/title editing, T/A keyboard
pickers) complete 2026-06-12. Milestone 6 (GitHub webhook magic-word
PR/commit linking, D29 — HMAC-verified endpoint, alias-aware key
resolution, PR/commit display; local secret in `.dev.vars`) complete
2026-06-12; GitHub-side registration rides with deploy. Milestone 7 mobile
pass complete (D30: touch drag via hold-delay sensor, phone-viewport
verified; production build + deploy dry-run pass). Remaining for v1, all
owner-credential-gated: production deploy, Cloudflare Access (exclude
`/api/webhooks/github`), GitHub webhook registration, dogfood cutover
(SPEC §7, §8.3). Then v1.x agent integration (context bundle, MCP server,
work kickoff — SPEC §11/D28). `bun run dev` serves everything on :8000
(see `docs/SETUP.md`). Shared wire types live in `src/shared/`. Synthetic
5k-issue data: `bun run db:seed:scale`; reset via `docs/SETUP.md` §2. Update
this section as phases change.
