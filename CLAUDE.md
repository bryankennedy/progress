# Progress

A single-user, web-based tracker (a "personal Linear" with the owner's own
hierarchy: Initiative → Product → Repo/Arc → Issue). Built for product
development; **v2 broadens it to any area of responsibility** — including
personal/household work — without changing the nouns (a household area is a
repo-less Product with Arcs). See `docs/SPEC.md`.

## Documents — read before non-trivial work

Organized per Diátaxis (map: `docs/README.md`). Built vs. planned is split
deliberately — keep it that way as milestones land:

- `docs/REFERENCE.md` — the system **as built** (domain rules, API, client
  architecture, keyboard map). Present tense; update it when shipping.
- `docs/SPEC.md` — vision, principles, and the **not-yet-built** roadmap;
  currently **v2** (non-dev/household use, due dates, the Agenda view). Source
  of truth for scope of remaining work. Section numbers are stable (code
  comments cite them); when an area ships, shrink its section to a pointer into
  REFERENCE rather than renumbering. The frozen **v1** roadmap is
  `docs/archive/SPEC-v1.md` — pre-v2 `SPEC §X` citations resolve there.
- `docs/DECISIONS.md` — append-only decision log. Settled questions live here;
  don't re-litigate them — supersede with a new entry if something changes. New
  entries are **keyed to their issue** (`### KEY — title`), not a running `D<n>`
  number, so parallel agents on different issues don't collide (PROG-62); D1–D48
  keep their historical numbers. Always append at the **bottom**: the file is
  `merge=union` (`.gitattributes`), so parallel appends merge as keep-both with
  no conflict — which only holds while the log stays append-only, so supersede
  settled entries, never rewrite them (`DECISIONS-union`).
- `docs/SETUP.md` — how-to: install, run, schema changes, deploy.

When a decision of consequence is made in conversation, record it in
`docs/DECISIONS.md` in the same session.

## Hard requirements (never trade away)

1. **Instant UI.** Whole workspace loads into a client store; all mutations are
   optimistic; a spinner on user interaction is a bug. See SPEC §2.1.
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

**v1 — complete & in production** (2026-06-12 deploy; dogfood cutover 2026-06-16,
D32). The product-development tracker shipped end-to-end: domain schema +
load-everything client (D17–D21), real views + command palette (D22–D25),
container/tag CRUD (D26–D27), GitHub webhook linking (D29), mobile pass (D30),
production deploy + Cloudflare Access + service token (D31–D32), and the **Agent
Integration arc** — context bundle (PROG-17/D33), MCP server (PROG-18/D34),
work-on-this kickoff (PROG-19/D35). Live at
<https://progress.bryan-22c.workers.dev>. Full v1 history: `docs/archive/SPEC-v1.md`
+ DECISIONS D1–D35. Owner-side leftover: GitHub webhook registration on connected
repos (PROG-16) lights up the linked-PR/commit sections.

**v2 — complete & in production** (2026-06-17 deploy; migration `0003`).
Progress now spans **any area of responsibility** (incl. personal/household) and
gained the time dimension v1 omitted: (1) repo-less products first-class +
frictionless structure creation — header **New** menu, inline "+ New
product/arc" in the new-issue dialog, and a `/structure` overview route (§3–§4,
D40); (2) **due dates** — optional calendar-day field, timezone-safe
`YYYY-MM-DD` text, editable on the issue page / new-issue dialog / palette `D`
picker / Agenda rows (§5, D37); (3) the **Agenda view** at `/agenda` — dated
pending issues grouped Overdue/Today/This week/Later with a reusable priority
indicator (§6–§7, D38/D39). Nouns unchanged. Recorded in prod as the **v2 —
Broaden & Due dates** arc (`scripts/dogfood-v2.ts`). Owner-side leftover from v1
still open: GitHub webhook registration (PROG-16/PROG-30).

**Phase: v2.1 / v3 robustness — in progress.** Shipped: **manual kanban
ordering** (PROG-43/D43) — each issue carries a fractional-index `rank`, so cards
have a drag-to-set vertical work order within a column (migration
`0005_issue_rank`); **CI/CD auto-deploy** (PROG-54/D45) — push to `main` runs
`.github/workflows/ci.yml` (typecheck + unit-test gate, then remote D1 migrate +
`wrangler deploy`); see `docs/SETUP.md` §6; **search** (PROG-130/PROG-130 entry)
— a `/` quick-jump modal + filterable `/search` page over titles, descriptions,
and comments (instant client-side title/desc + a streamed `GET /api/search`
`LIKE` query for comments; REFERENCE §5). Likely next
step per SPEC §8: **recurring due dates** (chores repeat); the due-date model +
Agenda were built not to preclude it. Also pending: reminders/digests, start
dates, date+time.

`bun run dev` serves everything on :8000 (see `docs/SETUP.md`). Shared wire types
live in `src/shared/`. Synthetic 5k-issue data: `bun run db:seed:scale`; reset
via `docs/SETUP.md` §2. Update this section as phases change.
