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

### D23: Board infrastructure
- **Drag-and-drop: @dnd-kit/core.** Headless, touch-capable, ~10kB; native
  HTML5 DnD can't do smooth previews or touch. Cards are draggables, columns
  are droppables, drops call the same `setIssueStatus` as everything else. A
  4px pointer activation threshold keeps plain clicks navigating to the
  issue page. No sortable within columns (D19: no manual ordering).
- **Filters live in URL query params** (`/?product=…&arc=…&backlog=1`), so
  any filtered board is bookmarkable — this is what makes deferring
  per-product/per-arc boards viable (SPEC §4); container pages link to their
  own filtered board view. Repo/arc filter options narrow to the selected
  product.
- **Backlog hidden by default** behind a toggle (open question #2 default
  adopted). Done and Canceled columns always render.
- **Container pages are one component** parameterized by type; scope and
  child links derive from the workspace in memory. Inline list edits reuse
  the optimistic template. Container description editing is deferred (needs
  container PATCH endpoints; not part of this pass).

---

## 2026-06-12 — Milestone 4: creation, movement, command palette

### D24: Issue creation and movement semantics
- **`POST /api/issues`** allocates the issue number with an atomic
  `next_issue_number` increment on the product (D18). A crash between
  allocation and insert leaves a number gap — harmless, numbers only need to
  be unique and monotonic, not dense.
- **Creation is optimistic including the key**: the client allocates the
  number from the store's `nextIssueNumber` mirror, valid because this client
  is the only writer in v1. The temp row is swapped for the server row (same
  key, real id), so creating can navigate to the new issue page instantly
  with zero spinner. The create dialog defaults its container from wherever
  the user is (container page, viewed issue's container, or the board's
  active filters) and defaults status to **Todo**, not Backlog — a freshly
  created issue should be visible on the default board, which hides Backlog.
- **`POST /api/issues/:id/move`** (SPEC §3): within a product the key and
  arc survive and only `repo_id` changes. Cross-product moves re-key from
  the target's sequence, clear the arc, write the retired key to
  `issue_key_aliases`, and append a `moved` activity event (with from/to
  container ids, and old/new keys when re-keyed). The client mirrors all of
  it optimistically — including the local re-key and alias append — so an
  open issue page redirects to the canonical key with no round trip.
  Rollback restores exactly what the move touched.

### D25: One keyboard surface — the command palette
- **Hand-rolled palette**, no dependency (`cmdk` rejected: the dependency
  budget is tight per SPEC §8.2 and case-insensitive substring matching is
  plenty at single-user scale). Root mode searches issues by key — retired
  alias keys included, via the same `findIssueByKey` the router uses — or
  title, containers by name, plus commands.
- **Single-key actions open the palette in a picker mode** (status /
  priority / estimate / move) scoped to one issue, rather than bespoke
  menus: one component, one interaction grammar, every picker filterable.
- **Key map (SPEC §4 "decided during build"):** `⌘K`/`Ctrl+K` palette ·
  `C` create issue · `S` status · `P` priority · `E` estimate · `M` move.
  Plain keys are suppressed while typing in any input/textarea/select.
- **"Current issue"** for single-key actions = the issue page's issue, or
  on boards/lists the card/row under the pointer or holding keyboard focus,
  tracked by document-level event delegation on the `data-issue-id`
  attributes the views already render — no per-component wiring.
- Cross-cutting cleanup: status/priority display names moved to one shared
  `src/client/labels.ts` (palette, board, and pages had three copies).

---

## 2026-06-12 — Milestone 5: the CRUD gaps

### D26: Container CRUD + archive semantics
- **POST + PATCH for all four container types.** PATCH covers name,
  description, `archived` (boolean, mapped to `archivedAt`), plus
  `keyPrefix` on products (letters-only 2–8, globally unique — rename is
  safe because keys are derived, D18) and `gitUrl` on repos.
- **Container ids may be client-generated.** Container pages are
  id-addressed, so optimistic create + instant navigation requires the id
  to survive reconciliation. The store generates `prd_<uuid>`-style ids and
  the server accepts well-formed ones verbatim (single-user; the server
  still validates shape and falls back to its own id). Issues didn't need
  this — they're key-addressed and the key is computable client-side.
- **Archive = out of navigation, not out of existence.** Archived
  containers disappear from board filter dropdowns, create-dialog targets,
  move targets, and palette search; their issues remain visible everywhere
  (nothing silently vanishes from the board), and parent container pages
  list archived children dimmed so unarchive stays reachable.
- Editing UI: shared `InlineEdit` (single-line; Enter commits, blur/Escape
  cancels) and `EditableMarkdown` (extracted from the issue page) cover
  container names, prefixes, git URLs, descriptions, and issue titles.

### D27: Tags — minimal UX (open question #3 closed)
- **Auto-color**: fixed 7-color palette in `shared/constants.ts`, picked by
  a stable name hash — shared by server and client so optimistic rows match.
- **One endpoint assigns and creates**: `POST /api/issues/:id/tags` takes
  `tagId` (existing) or `name` (create-or-get, then assign) so the palette's
  "Create tag 'x'" is one atomic call. `DELETE …/tags/:tagId` unlinks; tag
  rows are never deleted in v1.
- **Picker = palette mode T**: toggles stay open for multi-tag editing; the
  arc picker (mode A) follows the same pattern with the same-product
  constraint enforced in `PATCH /api/issues/:id` (`arcId`). Keyboard map
  from D25 extends to `T` (tags) and `A` (arc).

### D28: Claude Code agent integration is the headline v1.x direction
Recorded as SPEC §11 (per owner, 2026-06-12): issues should be executable
work orders. Three pieces — a deterministic per-issue **context bundle**
endpoint, an **MCP server** on the Worker for inbound "work on PROG-123"
interrogation/updates from Claude Code, and an **outbound kickoff** (CLI
handoff first, cloud sessions later) that works in a branch named from the
issue key so §5 webhook linking closes the loop automatically. Roadmap
re-prioritized: webhook milestone next (it's a prerequisite for the loop),
then deploy/dogfood, then bundle + MCP, then outbound kickoff. "API for
third-party clients" is hereby promoted from deferred to planned-v1.x (as
the MCP surface). Implementation decisions deferred to the build.

---

## 2026-06-12 — Milestone 6: GitHub webhook linking

### D29: Webhook + git-link design
- **Two link tables** (the ones D19 deferred): `pr_links` with mutable
  state/title, `commit_links` immutable. Composite PKs (`issueId + repo +
  number`, `issueId + sha`) double as the idempotency guard — GitHub
  redeliveries are no-ops by construction. Rejected: one polymorphic links
  table (PR state updates would be awkward), storing full commit messages
  (subject line is all display needs).
- **`githubRepo` is `"owner/name"` text, not an FK to `repos`** — links
  must survive container renames/archives, and deliveries can come from
  repositories that aren't (or aren't yet) containers in Progress.
- **Magic-word semantics**: candidates `\b[A-Za-z]{2,8}-\d+\b` resolved
  against current keys then aliases (server-side mirror of
  `findIssueByKey`); unresolved prefixes drop out, so prose like "UTF-8"
  can't false-positive. Branch-name keys link every commit in the push;
  message keys link their commit; PR keys come from title + body + head
  branch. **Links are permanent** — editing a mention away later doesn't
  unlink (matches the alias philosophy: references never break).
- **Activity**: `pr_linked` / `commit_linked` rows only on first sight of a
  link; PR state changes update the link row silently (the state badge is
  the display, not the feed). New event types render on the issue page's
  timeline; links themselves load with the per-issue timeline endpoint
  (same unbounded-growth reasoning as D20), not the workspace payload.
- **Auth**: HMAC SHA-256 over the raw body, constant-time compare; 503
  when `GITHUB_WEBHOOK_SECRET` is unset, 401 on bad signature. Local secret
  via `.dev.vars` (the Wrangler convention; gitignored), production via
  `wrangler secret put`. GitHub-side webhook registration needs a public
  URL and therefore rides with the deploy milestone; verified locally with
  signed payloads (20 API checks + UI render checks).
