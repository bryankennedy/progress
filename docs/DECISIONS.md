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

---

## 2026-06-12 — Milestone 7 (part): mobile pass

### D30: Touch interaction model for the board
The drag sensor split is **MouseSensor (4px distance) + TouchSensor (250ms
hold, 8px tolerance)**, replacing the single PointerSensor: on a phone, a
swipe must scroll the board horizontally and a tap must open the card, so
press-and-hold is the only gesture left for dragging — the standard
mobile-kanban convention. Cards get `touch-action: manipulation` (not
`none`, which would kill scrolling over cards). Shell padding tightens on
small screens; everything else already reflowed (issue page sidebar stacks
under the content via the existing `md:` breakpoint). Verified at 390×844
with touch in headless Chromium: no horizontal page overflow on board /
issue / container pages, lane scrolls, taps navigate, dialogs fit; desktop
mouse drag regression-tested after the sensor swap. Production build +
`wrangler deploy --dry-run` pass; the deploy itself and Cloudflare Access
are owner-credential-gated (dashboard/Zero Trust work, not repo code).

---

## 2026-06-16 — Production hardening + dogfood cutover (v1 done)

### D31: `/api/workspace` loads via `Promise.all`, not `db.batch`; worker logs its errors
The production `/api/workspace` returned **HTTP 500** while local Miniflare
served it fine. Bisecting by what differs from working paths: write-batches
(the 2-statement issue PATCH) and the 4-statement read-batch behind the
issue timeline both work in production — only the **9-statement read
`db.batch` in the workspace load** failed. The nine reads are independent
and need no transaction, so the fix replaces the `db.batch([...])` with
**`Promise.all([...])`** of the same queries — the Cloudflare-recommended
shape for independent reads, which also removes the local-vs-production
runtime difference. The other batches (all writes, plus the small timeline
read-batch — proven working, including 13 PATCHes during the cutover) are
left as-is; speculatively rewriting working production code is the wrong
trade.

Root-cause-of-the-batch was never captured as a stack trace, because the
worker had **no error logging at all** — an uncaught throw became a bare
`Internal Server Error`, which is precisely why "look at the logs" turned up
nothing. So the durable half of this fix is an **`app.onError`** handler
that `console.error`s the real exception (visible in `wrangler tail`) and
returns a generic `{error:"internal_error"}` body — generic on purpose, so
the Access-bypassed webhook path can't be used to read internals. Any future
500 is now diagnosable from the logs, and the swap-to-`Promise.all` recipe
is the first thing to try if another read-batch surfaces the same failure.

### D32: Dogfood cutover — Progress's backlog now lives in Progress (v1 = done)
Per SPEC §7, v1 is "done" when Progress's own backlog moves out of `docs/`
and into Progress, in production. Executed via `scripts/dogfood-cutover.ts`
against the live API — **not raw SQL** — authenticated with the Cloudflare
Access **service token** (the §8.3 / §11.4 non-interactive-auth pattern,
its first real exercise; same bypass idea as the webhook's HMAC, but for
reads/writes). The script is idempotent (skips existing titles, PATCH-to-
done is a no-op once done). It marked the 14 milestone issues (PROG-1..14)
done, created the **Agent Integration** arc, and seeded the v1.x backlog
(context bundle, MCP server, work kickoff, the service token itself, this
cutover, PR-driven automation). Production now holds 22 issues across 3
arcs. PROG-15 (an issue the owner had already filed in-app) was left
untouched — real dogfood usage, not seed data. Remaining v1 hookup is
owner-side only: registering the GitHub webhook on connected repos.

### D33: Context bundle is key-addressed Markdown, not JSON (PROG-17, first v1.x brick)
`GET /api/issues/:key/bundle` (SPEC §11.1) returns **`text/markdown`**, not
JSON — the bundle *is* the artifact handed to an agent (or pasted as a
prompt), so the endpoint emits the finished work order rather than fields a
caller must re-render. Errors stay JSON (`{error}`, 400/404) per the API
contract; only the success body is Markdown. The route is addressed by
**issue key, not internal id**, and resolves through `resolveIssueKeys`
(the same alias-aware path the webhook uses): a retired key still resolves
and the bundle always renders the *current* canonical key. Rendering is
deterministic — values come straight from row data (no `Date.now`/locale)
and collections are pre-sorted — so the same issue renders byte-for-byte
identically (matters for a copy-as-prompt artifact and for diffing what an
agent was given). Content: issue fields + tags, lineage **with descriptions**
(product → repo incl. `gitUrl` → arc — the arc description is the
epic-level "why"), comments, linked PRs/commits, then a **stable report-back
preamble** (branch/commit/PR mention the key → §5 auto-linking, which works
today; comment/status updates ride the API/MCP surface in PROG-18). The
reads are independent, so they run via `Promise.all` per [D31]. The "copy as
prompt" button (§11.1) is a thin client follow-on, naturally bundled with
the outbound kickoff work (PROG-19).

### D34: Progress MCP server is a local stdio *client* of the API (PROG-18)
The §11.3 MCP surface (`src/mcp/server.ts`, `bun run mcp`) is a **local stdio**
MCP server the owner registers in Claude Code — **not** a remote MCP endpoint
hosted on the Worker. The deciding constraint is in the issue itself:
"authenticates with the Access service token (§11.4)." A server that
*presents* the service token is a **client** of the Access-protected API; a
Worker-hosted endpoint would instead sit *behind* Access and be
authenticated-to. The client shape also keeps the Worker the single source of
truth for domain logic (the "rigid simplicity" rule) — the MCP server holds no
schema or business rules, only thin wrappers over existing routes plus
key→id/name resolution off one `/api/workspace` snapshot (the same alias-aware
resolution the Worker does). Validation vocabularies are imported from
`src/shared/constants.ts`, the dependency-free source of truth, so the tools
can't drift from the API's accepted statuses/priorities/estimates. Tools are
**key-addressed** (agents speak in keys like PROG-18, not opaque ids) and
mirror the API one-for-one: `get_bundle, get_issue, list_issues, create_issue,
update_status, comment, move_issue`. Auth reads `CF_ACCESS_CLIENT_ID/SECRET`
(the header names) with a `PROD_CF_ACCESS_*` fallback so the same `.env` the
dogfood scripts use just works; `PROGRESS_BASE_URL` retargets it at local dev.
Transport/SDK: `@modelcontextprotocol/sdk` over stdio (stdout is the JSON-RPC
channel — the server logs only to stderr). *Rejected:* a Worker-hosted
streamable-HTTP MCP server — it would duplicate auth handling, add a hosting
surface to the Worker, and contradict the "authenticates with the token"
framing; can be revisited if a browser-side or multi-client MCP need appears.
Read tools verified end-to-end against production over stdio; the write tools
reuse routes already exercised by the dogfood cutover (D32).

### D35: Work-on-this kickoff — in-app copy + a `progress work` CLI (PROG-19)
The outbound surface (SPEC §11.2) ships as two thin layers over the existing
bundle endpoint (D33), no new server code:

- **In-app** (`src/client/workOn.ts`): the issue page's **Work on this** field
  and the `W` palette command copy either the bundle Markdown ("Copy as
  prompt" — the §11.1 button) or the `progress work <KEY>` CLI line. The bundle
  is fetched from `GET /api/issues/:key/bundle` and **prefetched on issue load**
  into a module cache, so the click copies synchronously — honoring "no
  interaction spinner" (SPEC §8.2) and staying inside the clipboard's
  user-activation window.
- **CLI** (`bin/progress.ts`, exposed as `progress`): `progress work <KEY>`
  fetches the bundle with the Access service token (the D34 auth pattern),
  creates/checks out `iss/<KEY>`, and `spawnSync`s `claude` with the bundle as
  the opening prompt (direct exec, no shell — the Markdown can't be
  reinterpreted). `--print` emits the bundle instead; `--no-branch` skips the
  checkout.

Two deciding choices: (1) **Branch-from-key is default-on**, not opt-in —
SPEC calls it "the linchpin" for §5 auto-linking, and doing it at kickoff is
what makes agent commits/PRs flow back with zero ceremony; `--no-branch` is the
escape hatch. (2) **The CLI operates in the current directory** and never
resolves a repo from its `gitUrl` — that keeps Progress free of
machine-specific knowledge of where checkouts live (SPEC §11.2); the user runs
it from the repo they mean. *Rejected:* a web-UI "launch a cloud session"
button (SPEC §11.2 "Later") — needs headless-Claude infra and a repo-location
map, out of scope for v1.x minimal. The bundle being key-addressed Markdown
(D33) is what lets both layers be this thin. This completes the Agent
Integration arc (D33 bundle → D34 MCP → D35 kickoff).

## 2026-06-17 — v2 scope (broaden to any responsibility + due dates)

### D36: v1 spec archived; v2 keeps the nouns and adds the time dimension
v1 shipped and was dogfooded, so its roadmap (`docs/SPEC.md`) is frozen as a
development artifact at `docs/archive/SPEC-v1.md` and `docs/SPEC.md` restarts as
the **v2** roadmap with fresh section numbers. v1's section numbers are cited by
code comments and earlier decisions, so the archived file is kept **unchanged**
(its body's relative doc links were repathed `./` → `../` for the new depth, the
only edit) and those `SPEC §X` citations resolve there.

v2 broadens Progress from a product-dev tracker to **any area of
responsibility** (incl. personal/household). Four scoping calls, settled this
session:

- **Keep the nouns.** A household area is modeled as a **Product** with **Arcs**;
  **Repo stays optional/dev-only** and repo-less products become first-class. No
  vocabulary change. *Rejected:* a domain-neutral top-level noun or a parallel
  personal hierarchy — both cost the "rigid simplicity"/"owner's nouns" hard
  requirements to save one small mental stretch ("Product" = life-area).
- **Due dates are one-off, date-only, timezone-safe.** An optional issue field
  holding a **calendar day** (`YYYY-MM-DD`), the same date everywhere — *not* an
  instant, unlike `createdAt`/`updatedAt`. *Rejected for this phase:* recurring
  due dates (the likely next step — chores repeat — so the model/Agenda are
  built not to preclude it), date+time, start dates, reminders.
- **A dedicated Agenda view.** Dated issues grouped **Overdue / Today / This
  week / Later**, sorted by due date, each row with a visual **priority
  indicator**; undated and completed issues excluded; filterable by
  product/arc/tag (URL params, like the board). *Rejected:* a sort-mode bolted
  onto the existing kanban, or a flat ungrouped list — the grouped view is the
  one that answers "what's due" at a glance.
- **Structure creation is surfaces, not new endpoints.** Inline "+ New …" in the
  create-issue pickers plus dashboard entry points (header "New" + a Structure
  overview route) reuse the v1 container write paths (D26); nothing new
  server-side. Folds in the previously-deferred "add arc from the New Issue
  modal".

Full plan: `docs/SPEC.md` (v2). Build sequence is SPEC §11; the one schema change
is a nullable `due_date` on `issues`.

## 2026-06-17 — v2 build (broaden + due dates, shipped)

The v2 roadmap (`docs/SPEC.md`) shipped end-to-end and was deployed to
production (version 18db5f52, migration `0003_breezy_spot.sql`). Four
build-time calls settle the SPEC §9 open questions.

### D37: due dates are stored as ISO `YYYY-MM-DD` text
The new `issues.due_date` column is **nullable TEXT** holding a canonical
`YYYY-MM-DD` calendar day, not a normalized integer and not an instant
(contrast `createdAt`/`updatedAt`, which are unix-epoch timestamps). This is the
timezone-safety requirement of SPEC §5 made concrete: a due date is the same
wall-calendar day everywhere, so it must not carry a time or zone. Text keeps it
human-readable in the DB and in the workspace payload, sorts correctly
lexicographically (so the Agenda sorts by string compare), and round-trips
through JSON unchanged. The API validates the canonical form and rejects
impossible dates (e.g. `2026-13-40`) by re-serializing through UTC midnight.
*Rejected:* an integer (days-since-epoch or packed YMD) — saves nothing and
loses legibility. Closes SPEC §9 Q5.

### D38: Agenda is a top-level destination; "This week" is a rolling 7 days
The Agenda is its own route (`/agenda`) and its own header nav entry, alongside
the board — **not** a tab or sort-mode bolted onto the kanban. The board answers
"what's the state of the work"; the Agenda answers "what's due," and that
question deserves a first-class home. **"This week" is a rolling 7 days** from
the local today (buckets: Overdue = before today, Today, This week = next 6
days, Later) — simpler to reason about than "through end of calendar week," and
it matches how a due list is actually read. Buckets compute from the owner's
*local* day since due dates are calendar days. Closes SPEC §9 Q1 and Q2.

### D39: the priority indicator is a single color-coded dot
One reusable component (`PriorityIndicator`) renders the fixed
urgent/high/medium/low/none scale as a small filled dot on the global palette —
urgent `#ED6245` (red), high `#F08B23` (orange), medium `#F2C42E` (yellow), low
`#546EB4` (slate); **none is a hollow gray ring** so "no priority" reads as unset
rather than a fifth color. One mapping in `labels.ts` (`PRIORITY_COLORS`), no
configuration. Defined once for the Agenda; the board and lists may adopt it.
*Rejected:* bars or flags — a dot is the most compact at list density. Closes
SPEC §9 Q3.

### D40: structure creation is a dedicated `/structure` route + inline surfaces
Curating structure gets a dedicated route showing the Initiative → Product →
(Repo · Arc) tree with an inline "+ add" on each node — kept off the home board
so the board stays uncluttered. Plus a persistent **New** menu in the app header
(Issue · Initiative · Product · Repo · Arc) and inline **"+ New product/arc"**
in the create-issue dialog (which folds in the long-deferred "add arc from the
New Issue modal"). All of it reuses the v1 optimistic container write paths
(D26) — **no new write endpoints**; v2's structure work is surfaces only. Closes
SPEC §9 Q4.
