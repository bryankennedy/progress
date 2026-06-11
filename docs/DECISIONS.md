# Decision Log

Append-only. Newest at the bottom. Each entry: what was decided, why, and what
was rejected. Do not re-litigate settled decisions — supersede them with a new
entry that references the old one.

---

## 2026-06-11 — Founding decisions (spec interview)

### D1: Product identity — a product-development tracker, not a to-do app
Single-user work tool for building products. Personal *user*, professional
*domain*. Rejected: any life-admin/GTD framing.

### D2: Custom hierarchy is the core feature
`Initiative → Product → (Repo | Arc) → Issue`. The pain with Linear/Jira/GitHub
Issues is vocabulary mismatch, not missing features. The tool's nouns must match
the owner's mental model exactly.

### D3: "Arc" is the epic-like grouping
Belongs to a product; groups issues from anywhere under that product (including
its repos). Rejected names: "epic" (baggage), "project" (overloaded), "feature",
"milestone", "track".

### D4: Fixed, Linear-style statuses
Backlog / Todo / In Progress / In Review / Done / Canceled — one global set, not
configurable. Rigidity is a feature. Rejected: per-product status sets, custom
workflows.

### D5: Repos are real containers with git identity
A repo is both a sub-container of a product and a pointer to an actual git
repository. No GitHub Issues sync (non-goal). PR/commit linking IS in v1 via
webhook magic words (issue key in branch/commit/PR), without status automation.

### D6: Per-product issue keys
`PREFIX-n` (e.g. `PROG-123`). Keys survive moves within a product; cross-product
moves re-key with a permanent alias/redirect. Rejected: global sequence, no IDs.

### D7: v1 board = one global "My Work" kanban
Filterable by initiative/product/repo/arc/tag/priority. Per-container boards
deferred — filters cover them. Kanban before sprints; sprints deferred entirely.

### D8: Issue fields — priority and estimate in, due dates out
Priority (Urgent→None), estimate (points), tags, comments + auto activity feed.
Due dates deliberately omitted from v1: sizing matters more than deadlines here.

### D9: Mobile-friendly is in v1
Responsive web UI that works on a phone. Cut from v1 instead: sprints,
multi-user, notifications.

### D10: Stack — Cloudflare Workers + D1, Hono, React + Vite + Tailwind
Fits existing Cloudflare tooling, near-zero hosting cost, easy webhooks.
Bun for packages/scripts, TypeScript strict, ESM. Rejected: Node server on a
VPS, full-stack framework + managed Postgres.

### D11: React is acceptable ONLY with the speed architecture
Owner's hard requirement: snappy as heck, never Jira-laggy. React chosen for
familiarity + ecosystem, conditional on the Linear pattern: whole workspace
loaded into a client store, optimistic mutations everywhere, zero interaction
spinners (see SPEC §8.2). If an interaction can't be made instant, the
architecture is wrong, not the requirement.

### D12: Auth via Cloudflare Access
Zero-trust in front of the app; no auth code in v1. Webhook route bypasses
Access and verifies GitHub's HMAC instead. Rejected for v1: built-in login,
GitHub OAuth (revisit when multi-user arrives).

### D13: Schema is multi-user-ready from day one
`users` table with one row; creator/assignee/author FKs everywhere. Avoids a
rewrite when collaborators arrive, costs almost nothing now.

### D14: The name is Progress
Confirmed, matching the repo directory.

---

## 2026-06-11 — Milestone 1 scaffold

### D15: Single-app structure on the Cloudflare Vite plugin
One package, one Vite dev server: `@cloudflare/vite-plugin` runs the Hono
Worker (with a real local D1 via Miniflare) inside `vite dev`, so client and
API share a port and deploy as one Worker (SPEC §8.1). Layout:
`src/worker` (Hono) / `src/client` (React) / `src/db` (Drizzle schema), with
split tsconfig project references because Workers and DOM type globals clash.
Rejected: monorepo with separate api/web packages (overhead with no payoff for
one Worker); `create-cloudflare` template scaffold (hand-rolled instead so
every file is understood and documented in `docs/SETUP.md`).

### D16: Migrations are Drizzle-generated, Wrangler-applied
`src/db/schema.ts` is the single schema source of truth. `drizzle-kit generate`
emits SQL into `drizzle/` (committed); `wrangler d1 migrations apply` runs them
locally and, later, in production. Seeds live in `scripts/seed.sql` and are
idempotent. Rejected: `drizzle-kit push` (no migration history) and hand-written
SQL migrations (schema and SQL would drift).

(Open question #4 — client store library — remains open; it gets decided when
the store is actually built in milestone 2, with the latency spike from SPEC §9.)

---

## 2026-06-11 — Milestone 2: domain schema

### D17: Issue container is `product_id` (always set) + nullable `repo_id`
An issue's container is a product or one of that product's repos, never both,
never neither (SPEC §3). Modeled as a non-null `product_id` plus a nullable
`repo_id` that narrows the container: `repo_id IS NULL` means product-level.
Filtering/grouping by product — the dominant query — never needs a join, and
"move between product-level and repo-level" is a one-column update. The
invariants SQLite can't express cheaply (`repo_id` belongs to the same product;
arc same-product) are API-enforced. Rejected: polymorphic
`container_type`/`container_id` (loses FK integrity, every product rollup needs
a join); separate junction table (overkill for a 0..1 relationship).

### D18: Issue keys are derived, never stored
The display key is `product.key_prefix + '-' + number`; only `number` is stored
(unique per product). A prefix rename therefore re-keys everything consistently
with zero data migration. Retired keys from cross-product moves are stored
verbatim in `issue_key_aliases` (text PK, e.g. `PROG-123`) since aliases must
survive any later prefix changes. Per-product sequence is a
`next_issue_number` counter on `products`, incremented transactionally on
create and cross-product move — fine at single-user write rates.

### D19: Schema-wide conventions
- IDs: app-generated text with a type prefix (`usr_`, `ini_`, `prd_`, `rep_`,
  `arc_`, `iss_`, `tag_`, `cmt_`, `act_`) — identifiable on sight in URLs/logs.
- Timestamps: unix-epoch integers set by the API (not DB defaults), Drizzle
  `mode: "timestamp"`.
- Fixed vocabularies (status, priority, estimate points) live as `as const`
  arrays in `schema.ts`; status/priority are Drizzle text enums, estimate is
  API-validated.
- Archive everywhere: nullable `archived_at` on all four container types; no
  hard deletes.
- No manual board ordering column in v1: SPEC §4 specifies sorting/filtering by
  fields, not hand-ordering. Add later via migration if it earns its way in.
- Git PR/commit link tables are deferred to the webhook milestone; `activity`
  rows carry a JSON `data` payload, so linked-PR events already have a home.

### D20: Workspace payload excludes comments and activity
`GET /api/workspace` returns users, all containers, issues, tags, issue-tag
links, and key aliases in one D1 `batch()`. Comments and activity — the only
unbounded-growth tables and not needed for boards/lists — load per issue when
an issue page opens. Keeps the load-everything payload small for years of use
(SPEC §8.2).

## 2026-06-11 — Milestone 2: client store spike

### D21: Client store is TanStack Query (open question #4 closed)
Decided by the latency spike, not taste. Method: 5,000-issue synthetic
workspace (`bun run db:seed:scale`, deterministic), two prototypes rendering
an identical 6-column board of all 5k issues with one optimistic mutation
(status cycle, real PATCH + rollback), driven by 100 real DOM clicks in
headless Chromium with double-rAF click-to-paint timing and React Profiler
commit timing.

Results (p50/p95 click-to-paint): **TanStack Query 23ms/98ms** vs bespoke
normalized store with per-issue/per-column `useSyncExternalStore`
subscriptions **73ms/128ms**. The bespoke store's theoretical advantage
(1 card + 2 column renders per mutation vs ~490 card renders) did not
materialize as latency: TanStack's structural sharing kept commits at ~17ms
vs 27ms, and total work fit in fewer frames. Both correct under a
column-movement check; both well under the perceptibility bar at realistic
board sizes (the 5k-card all-columns view is the worst case; the default
board hides Backlog per open question #2).

TanStack also brings rollback/retry plumbing, devtools, and per-issue query
caching (comments/activity pages) for free, and eliminates the
subscription-bookkeeping code the bespoke store needed. Whole workspace lives
in one `['workspace']` query with `staleTime: Infinity`; mutations are
`setQueryData` snapshot/rollback writes.

---

## 2026-06-11 — Milestone 3: issue page

### D22: Issue page infrastructure
- **Routing: wouter.** First multi-view need; ~2kB hook-based router beats
  hand-rolling history plumbing and react-router's weight for three route
  shapes. URLs are key-based (`/issue/PROG-2`) — stable, human-meaningful,
  and alias-redirectable.
- **Key resolution is client-side.** The store already holds every issue and
  alias, so `/issue/:key` resolves from memory: current keys first, then
  `issue_key_aliases` with a `replaceState` redirect to the canonical key —
  no server round trip, honors SPEC §3 permanent redirects.
- **Markdown: react-markdown** for descriptions and comments (safe by
  default, no raw HTML). Typography is a small hand-rolled `.prose-lite`
  stylesheet rather than the Tailwind typography plugin.
- **`PATCH /api/issues/:id` generalizes the status endpoint** to validated
  field patches (title, description, status, priority, estimate). A status
  change atomically appends a `status_changed` activity row (D1 batch), so
  the timeline is server-truth; the client invalidates the issue's timeline
  query after a successful status sync.
- **Timeline = comments + activity interleaved client-side** from one
  `GET /api/issues/:id/timeline` (two batched selects), per D20.
