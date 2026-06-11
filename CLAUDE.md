# Progress

A single-user, web-based product-development tracker (a "personal Linear" with
the owner's own hierarchy: Initiative → Product → Repo/Arc → Issue).

## Documents — read before non-trivial work

- `docs/SPEC.md` — what we're building and why. Source of truth for scope and
  domain rules.
- `docs/DECISIONS.md` — append-only decision log. Settled questions live here;
  don't re-litigate them — supersede with a new entry if something changes.

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

**Phase: building.** Milestone 1 (scaffold + walking skeleton) complete
2026-06-11. Milestone 2 in progress: full domain schema (D17–D19) and
whole-workspace load endpoint (D20) done — 11 tables, dogfood seed of the v1
backlog, all entities load in one batched query. `bun run dev` serves
everything on :8000 (see `docs/SETUP.md`). Remaining for milestone 2: client
store + optimistic mutations (open question #4 — store library — decided there
with a latency spike). Update this section as phases change.
