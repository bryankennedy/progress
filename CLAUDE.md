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

**Phase: building.** Milestone 1 — scaffold + walking skeleton — complete
(2026-06-11): Vite + React + Tailwind + Hono + D1/Drizzle in one app, end-to-end
round trip verified. `bun run dev` serves everything on :5173 (see
`docs/SETUP.md`). Next: milestone 2 — full domain schema + whole-workspace load
endpoint + client store. Update this section as phases change.
