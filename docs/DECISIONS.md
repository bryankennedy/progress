# Decision Log

Append-only. Newest at the bottom. Each entry: what was decided, why, and what
was rejected. Do not re-litigate settled decisions — supersede them with a new
entry that references the old one.

**Entry ids are keyed to the issue, not a running number.** Head a new entry
`### <KEY> — <title>` (e.g. `### PROG-62 — …`); a second decision from the same
issue gets a letter suffix (`### PROG-62b — …`). This lets agents working
different issues in parallel append without racing for the same number. Entries
**D1–D48** predate this convention and keep their numbers — cite them as `D33`
as before; cite issue-keyed ones by their key (`PROG-62`).

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

### D41: visual identity is the "Adobe & Moss" design system
Adopted the finished **"Progress — Adobe & Moss"** brand (delivered in
`brand-assets/`): a muted, papery, high-contrast look — deep ink (`#2c241b`) on
cream paper/canvas, **Spectral** for headings/body and **IBM Plex Mono** for
labels/meta/keys, with two semantic accents — **Salmon Adobe** (`#bb6f50`) for
primary actions / active "now" states (CTAs, links, active nav, open PRs) and
**Olive Moss** (`#79864c`) for completed/grounded states (done, merged PRs).
Tokens live in `brand-assets/tokens.css` (source of truth) and are **mirrored
into Tailwind v4's `@theme`** in `src/client/styles.css` rather than loaded as a
separate stylesheet, so each token is a utility (`bg-paper`, `text-ink`,
`bg-adobe`, `border-line`, `font-mono`, brand `--radius-*`). All ~250 hard-coded
`stone/sky/red/emerald/purple` utilities were refactored to these tokens
(one-shot pass, `scripts/retheme.mjs`). Brand icons + `manifest.webmanifest`
ship from `public/brand-assets/`. *Kept on-system:* errors/overdue use a derived
`--danger` (papery tomato), not a stock red; the priority-dot scale (D39) stays
on the global mermaid palette — it's a data encoding, not chrome. *Rejected:*
linking `tokens.css` directly (the handoff's non-Tailwind path) — duplicates the
palette outside Tailwind's utility system.

### D42: in-app Google auth replaces Cloudflare Access (supersedes D12)
**Supersedes D12.** The app now owns authentication and identity instead of
delegating to the Cloudflare Access edge. Motivation (PROG-34): Access was only
a gate — past it the Worker had zero identity awareness and every write was a
hardcoded `usr_owner`, so content was effectively anonymous. The Worker now runs
the **Google OAuth Authorization Code flow** itself (`src/worker/auth.ts`,
`/api/auth/login` · `/callback` · `/logout`), mints a **stateless signed session
cookie** (HS256 via `hono/jwt`; no sessions table — this is still the only writer
of its own data), and an `/api/*` middleware resolves identity per request and
attributes every write to it. *Decisions within:* (1) **owner-only allowlist** —
sign-in is gated by `ALLOWED_EMAILS` (currently just the owner), so an open
Google account can't read the workspace; (2) **bearer token for automation** —
the MCP server, `progress work` CLI, and dogfood scripts drop the Access
service-token headers for `Authorization: Bearer <PROGRESS_API_TOKEN>` (→ owner),
keeping a non-interactive path without Access; (3) **unconfigured = dev owner** —
when the OAuth secrets are absent the middleware falls back to `usr_owner`, so
`bun run dev` and tests need no Google setup; (4) **id_token validated by claims,
not signature** — it's received directly from Google's token endpoint over TLS
(the Google-sanctioned shortcut), so we check `iss`/`aud`/`exp` but skip JWKS/RS256,
keeping the module dependency-free. The webhook keeps its own HMAC and bypasses
the new middleware. Migration `0004_owner_email.sql` repoints the seeded
`usr_owner` to the owner email so sign-in resolves to the existing row,
preserving all historical attribution. *Rejected:* keeping Access with Google as
its IdP (doesn't move identity into the app — the stated goal); a D1 sessions
table (statelessness suffices); a `users.google_sub` column (email matching is
enough for owner-only; can add later as a stable anchor). Cutover steps + Access
teardown: SETUP §6.

### D43: kanban cards carry a manual order via a fractional-index `rank` (PROG-43)
Issues now have an explicit vertical order on the board, not just a status
column — so the owner can rank what to work on next, putting one card ahead of
another. The order is stored as a per-issue **`rank`**: a string
*fractional-index* key (`src/shared/rank.ts`) that sorts lexicographically, so a
card dropped between two others gets a key *between* their keys and the move is a
**single-row write** — no renumbering of neighbors, which keeps reordering
optimistic and instant (Hard requirement #1). Ranks are one global order; sorting
only ever compares cards within a column, so global position doubles as
in-column position. New issues are appended after the current last rank (bottom
of their column); migration `0005_issue_rank` backfills existing rows in the old
board order (by product, then issue number). The board upgrades from
`@dnd-kit/core` draggable/droppable to **`@dnd-kit/sortable`** for within- and
cross-column positional drops; a cross-column drop sends `status` + `rank` in one
PATCH. *Decisions within:* (1) **fractional index over an integer `position`** —
an integer scheme needs to renumber a whole column per drop (N writes) or leave
gaps that still eventually collide; fractional keys are O(1) writes and never
need rebalancing at single-user scale. (2) **home-rolled, dependency-free helper
over the `fractional-indexing` npm package** — keeps `src/shared` dep-free (like
`constants.ts`) and lets the migration backfill in pure SQL with compatible
fixed-width decimal keys; covered by `bun test` (100k-insertion torture test).
(3) **base-62, ASCII-ordered alphabet** so a byte-wise compare (SQLite's default
BINARY collation, and the client's `<`) equals digit order; keys are kept
**canonical (never end in "0")** so any gap stays subdividable. (4) **client
computes the key, server only validates** it's well-formed — mirrors the existing
optimistic-mutation split. *Rejected:* per-column integer positions (write
amplification); `localeCompare` for the client sort (case-folding would mis-order
letter-bearing keys — must be a binary compare).

### D44: two-tier access — env super-admins + a D1-managed allowlist (refines D42)
**Refines D42.** D42 gated sign-in on a single `ALLOWED_EMAILS` env secret, so
changing who can use the app meant editing a secret and redeploying. D44
splits access into two tiers: (1) **super-admins** — the env secret, renamed
`SUPER_ADMIN_EMAILS` — who can reach the **Admin** page (`/admin`) and are always
allowed; (2) **allowed users** — rows in a new D1 `allowed_emails` table
(`email` + optional `note` + `addedByEmail` + `createdAt`), edited at runtime
through the Admin page's optimistic CRUD. *Decisions within:* (a) **super-admins
are env-only, never in the table** — so the page can never remove the last admin
(no lock-out); (b) **enforce on every request, not just login** — the middleware
re-runs `super-admin OR allowlisted` per `/api/*` call and drops the session
cookie + `401`s on failure, so removal revokes a live 30-day session within
seconds (one cheap indexed D1 lookup per request, negligible at this scale);
(c) **start the table empty** — super-admins add everyone via the page; no data
migration from the old secret; (d) **the list is super-admin-only data** —
`/api/workspace` ships `isSuperAdmin` + `allowedEmails` to super-admins and an
empty array to everyone else; `/api/admin/*` is gated on the same per-request
flag. A transitional fallback reads `SUPER_ADMIN_EMAILS ?? ALLOWED_EMAILS` so the
rename doesn't lock anyone out before the prod secret is cut over; the old key is
removed in a follow-up. *Rejected:* login-time-only enforcement (a removed user
keeps access up to 30 days — too loose for an access tool); storing super-admins
in the table too (re-introduces lock-out risk). Migration `0006`.

---

## 2026-06-24 — v3 robustness: CI/CD

### D45: auto-deploy on push to `main` via GitHub Actions (PROG-54)
Production deploys were a manual `bun run deploy`, with schema changes needing a
separate remote-migration step — easy to forget, and nothing stopped failing
code from shipping. D45 makes pushes to `main` deploy automatically through a
single GitHub Actions workflow (`.github/workflows/ci.yml`): a **`test`** job
(`bun run check` + `bun test src`) gates every PR and the main push, and a
**`deploy`** job — `needs: test`, push-to-main only — applies pending D1
migrations `--remote` then `bun run deploy`s. *Decisions within:* (1) **GitHub
Actions over Cloudflare Workers Builds** — Workers Builds integrates via the
Cloudflare GitHub App, which only reaches github.com / GHE Cloud; this repo is on
a self-hosted GitHub-compatible host the app can't see. Actions driving
`wrangler` with a `CLOUDFLARE_API_TOKEN` is portable and keeps deploy logic
in-repo, and is effectively free at this repo's scale. (2) **Auto-apply
migrations as part of deploy** so code and schema never drift; D1 time-travel
(SETUP §6) is the safety net. (3) **Gate on typecheck + unit tests only**, not
Playwright e2e — the unit suite is ~1s and browser-free, keeping CI cheap and
stable per the owner's ask; e2e stays opt-in/manual. (4) **Branch protection**
on `main` requires the `test` check green before merge (PR-based flow), making
"don't deploy failing code" structural rather than a convention. *Rejected:*
Workers Builds (host-incompatible); deploy-code-only with manual migrations (the
drift footgun this issue exists to remove); e2e in the required gate (slow,
flaky, costly). `wrangler deploy` leaves existing `wrangler secret`s intact, so
prod `GITHUB_WEBHOOK_SECRET` is preserved across deploys.

---

## 2026-06-24 — Observability tooling (PROG-60)

### D46: Cloudflare Workers Logs (native) + Sentry for errors; defer product analytics
The observability question (PROG-60) was "one tool or two, cheapest path, 2026
landscape" for both *system errors* and *user activity*. Decision: treat them as
two concerns but solve only the system side now, with two free tools, and defer
the product-analytics side. *Decisions within:* (1) **System errors/ops →
Cloudflare Workers Logs (already enabled, `observability` in `wrangler.jsonc`) as
the searchable record + Sentry as the alert/triage layer.** Workers Logs is free
(200k events/day, 3-day retention) and already ingests our structured JSON logs
keyed by `requestId`; Sentry (`@sentry/cloudflare`, free Developer plan: 5k
errors/mo, 30-day retention) adds what Logs lacks — grouped exceptions with
stack traces, longer retention, and *alerting on a new error type*, which
Cloudflare's Notifications catalog has no native equivalent for (see SETUP §6).
They cross-link by `requestId`. (2) **Wire Sentry now**, gated entirely on
`SENTRY_DSN` so it's a no-op locally/in tests; tracing off (`tracesSampleRate:
0`) to stay in the free tier; needs `nodejs_compat`. (3) **User activity →
deferred.** This is a solo/allowlisted-few app, so "who did what" is already in
the structured request logs (`userId` + endpoint) landing in Workers Logs;
dedicated product analytics is overkill until there are multiple users to
analyze. *Rejected:* **GCP Cloud Logging** — wrong cloud for a Cloudflare Worker
(cross-cloud egress, second billing/auth surface, less generous free tier) and
buys nothing over the native path. **PostHog now** — the right tool *when*
multi-user product analytics becomes a real question (free 1M events/mo, 1-yr
retention); adopting it for one user adds a client SDK + privacy surface for
questions we don't have yet. Revisit Sentry vs. Cloudflare-native error tracking
later: the Baselime acquisition (2024) is folding error-tracking/alerting into
the Workers dashboard, which may eventually subsume the Sentry layer.

---

## 2026-06-24 — v3 design: priority indicator

### D47: priority indicator becomes Linear-style signal bars, toned on-palette (PROG-61, supersedes D39)
The D39 dot differentiated priority by **color alone**, so urgent vs high vs
medium was unreadable at a glance and invisible to color-blind users — and on a
card the priority showed as a plain text label, not the dot at all. D47 rebuilds
the same one reusable component (`PriorityIndicator`) as three ascending
**signal bars** (à la this app's "personal Linear" lineage): rank is carried by
**shape** (bars filled: low 1, medium 2, high 3) *and* color, so it survives
grayscale. **Urgent** breaks the ramp with a filled badge + exclamation so the
most pressing work pops; **none** is three faded bars (reads as "unset", same
intent as D39's hollow ring). The `PRIORITY_COLORS` map is retoned off the raw
spectrum (`#ED6245/#F08B23/#F2C42E/#546EB4`) into the warm **Adobe & Moss**
palette (D41) — urgent `#b23c28` (the on-system danger tomato), high `#bd6a30`
(terracotta), medium `#c79a31` (gold), low `#6f7896` (muted slate) — so the
glyph stops reading as stock UI chrome. One mapping, no configuration, still
SVG-cheap at list density. Adopted on the board card (replacing the text label),
the issue page Priority field, and container list rows; the Agenda inherits it
for free. *Rejected:* keeping the color-only dot (the legibility problem this
issue exists to fix); emoji (renders inconsistently per-OS, too heavy on a dense
board). Reopens and re-answers SPEC §9 Q3 (D39's "a dot is most compact"
conclusion did not survive contact with the board's at-a-glance scanning need).

Same change also surfaces the **due date on board cards** so date and priority
read together: a card footer puts the due date bottom-left (a calendar glyph +
the Agenda's own `relativeDue · formatDueDate` phrasing from `dates.ts`, reusing
its language so the two views agree — overdue in `danger`, due-today in
`adobe-deep`) and floats the priority glyph to the bottom-right corner. Estimate
and tags sit on their own line *above* the footer (not trailing the date) so the
two at-a-glance signals don't get crowded. Each line renders only when it has
content — estimate/tags line when either exists, footer when date or priority
exists — so bare cards stay clean.

### D48: the context bundle embeds a local smart-commit (PROG-62)
The "copy as prompt" work order (`GET /api/issues/:key/bundle`) already told a
handed-off agent *what to link* — branch named with the key, key in the
commit/PR so the §5 webhook auto-links it, status flow `todo → … → done`. It said
nothing about *how to craft the commits*, so that depended on whether the
receiving session happened to have the owner's `smart_commit` skill installed.
D48 inlines a condensed, key-aware copy of that skill as a **Committing & PRs**
subsection of the report-back preamble: the five steps (analyze → secret-scan →
plan logical chunks → Conventional-Commit `type(scope): KEY subject` with a *why*
body and **no `Co-Authored-By`/AI attribution** → verify). The commit example
interpolates the issue key, which both reinforces the existing auto-link
convention and matches the prod git history (e.g. `feat(observability): PROG-60
…`). It rides in the bundle text, so every surface inherits it for free — the
`W` palette / "Work on this" copy, the `progress work` CLI, and the `get_bundle`
MCP tool — with no dependency on the agent's local skill set. *Implementation:*
`renderBundle` + `BundleData` were extracted from the worker entry into
`src/worker/bundle.ts` so the render is unit-testable in isolation
(`bundle.test.ts` asserts the steps, the rules, key interpolation, and
determinism). *Rejected:* near-verbatim reproduction of the skill (too heavy for
an artifact pasted into every prompt); a generic `type(scope): subject` example
(loses the key reinforcement). Kept deterministic per D33 — the new text is
static plus the already-interpolated key.

---

## 2026-06-24 — v3 functionality: archived arcs

### D49: completed arcs collapse behind an `/archive` route, capped at 5 inline (PROG-45)
Archiving is the terminal "done" state for a container (no separate status —
D-era schema, `archivedAt`), and the Structure page rendered every archived arc
crossed-out inline. The owner's concern: once more than a handful pile up under a
product they bury the live structure the page exists to curate. Decision: on
Structure, **active arcs always show**; archived arcs still render crossed-out
but only the **first 5 per product** inline, with a "+N more in Archive →" link
once they exceed that. A new **`/archive`** route lists every archived arc
grouped Initiative → Product (mirroring the tree), reached from a top-nav
**Archive** link (after Structure) and from Structure's "+N more" link. The cap lives in a pure,
unit-tested helper (`capArchived`, `structureArchive.ts`) mirroring the Done-column
cap (`recentlyCompleted`, PROG-40 / `boardDone.ts`); the rendering stays in
`Structure`/`Archive`. **Per-product** cap (not a single global one) because arcs
are already grouped per product, so that's where the pile-up reads. Unarchiving is
unchanged — still the Archive/Unarchive toggle on the arc page. *Rejected:* hiding
archived arcs entirely (the issue's first framing — the owner's follow-up comment
refined it to keep the first few visible).

Header nav was reorganized alongside this: **Archive** is a top-level nav link
after Structure (the owner wanted it surfaced, not buried behind the "+N more"
link only), and the super-admin **Admin** link moved out of the top nav into the
profile avatar dropdown (alongside Sign out) — a rare destination doesn't earn
top-nav space, and the dropdown already gated on the signed-in user.

### PROG-62 — decision log keyed by issue, not a running number
First entry under the new scheme (and its own justification). The `D<n>`
counter assumed one author appending in sequence; with multiple agents working
different issues in parallel VMs, two of them independently reach for "the next
number" and produce a duplicate id plus a merge conflict on `DECISIONS.md` —
exactly the trivial-but-annoying collision that prompted this. Keying each entry
to the issue (`### <KEY> — title`) removes the shared counter, so entries from
different issues can never collide on their id; the only residual is a trailing
"both appended at EOF" git conflict, which is an unambiguous keep-both. Applied
in three places so the convention is coherent: this log's header rule, the
project `CLAUDE.md` decision-log description, and the **copy-as-prompt** bundle
(`src/worker/bundle.ts`) — a new *Avoiding merge collisions (parallel agents)*
section tells a handed-off agent to key append-only entries to its own issue
rather than a global sequence, generalized to any running-counter log.
*Rejected:* keeping the `D<n>` counter with a "rebase before appending" rule
(still races between branches, and renumbering on conflict is error-prone);
one-file-per-decision under `docs/decisions/` with a generated index (fully
conflict-free but a heavy restructure of 48 entries and every `(D33)` citation —
out of proportion to a trivial conflict, revisit if collisions persist).
Supersedes the implicit sequential-numbering convention; D1–D48 keep their
numbers (append-only, never renumber).

---

## 2026-06-24 — v3 robustness: external uptime monitoring

### PROG-47 — Better Stack as the general-purpose uptime/alerting layer
External uptime monitoring on `/api/health` is now live in **Better Stack**,
chosen as the *general-purpose* alerting tool for the whole stack rather than a
one-off for this app. The monitor polls `https://progress.bck.dev/api/health`
every 180 s (free-tier floor) from US + EU and emails the owner on failure;
because the endpoint round-trips D1, a `503` (DB unreachable) is a true
end-to-end outage signal — precisely the gap Sentry can't see, since a down
Worker throws nothing for error tracking to catch. The monitor is **config as
code**: `scripts/monitors.ts` declares the desired monitors and `bun run
monitors:sync` creates-or-updates them idempotently (name-keyed) through the
Better Stack Uptime REST API; adding an app is one entry in the `MONITORS`
array. `BETTERSTACK_API_TOKEN` is an **ops credential in `.env`** (like
`PROD_PROGRESS_API_TOKEN`), not a Worker secret — the Worker never calls Better
Stack, so it deliberately does *not* live in `.dev.vars`.

*Why Better Stack over the alternatives:* it bundles uptime + cron/heartbeat +
status page + on-call escalation on one generous free tier (10 monitors + 10
heartbeats + a status page), exposes a REST API (and a Terraform provider) for
config-as-code, and has a native Cloudflare integration — so it grows across the
stack without adding vendors. *Rejected:* **Sentry uptime/crons** — already wired
for errors (D46) and a fine *complement*, but the free tier caps at 1 uptime + 1
cron monitor and bills per extra monitor with no status page, wrong as the hub;
**UptimeRobot** — cheapest, but its free tier is non-commercial-use-only since
2024 and lacks bundled heartbeats/status; **Cloudflare Health Checks** — wrong
layer (it monitors origins *behind* the proxy and needs a Pro+ zone; a Worker has
no origin to point it at). Sentry stays the error-tracking/triage layer; the two
are complements, not competitors. *Deferred:* the public **status page** and a
**Slack** alert channel (both already free-tier-included) — email-only for now,
each a small follow-up when wanted. The existing onboarding monitor was *adopted*
(repointed from the bare host to `/api/health`) rather than duplicated.

### PROG-65 — Security headers, verified-email gate, gitUrl scheme check

A security/production-readiness review (PROG-65) found the code-side posture
strong — fail-closed auth, constant-time token/HMAC compares, parameterized
queries, `react-markdown` with no raw HTML, own-origin-only image resize, no
secrets in the repo or git history — and surfaced a small set of hardening gaps.
The public repo was confirmed clean of secrets (only the owner's own
name/emails/domains appear, an intentional develop-in-public choice).

**Decisions:**

- **Security headers ship in two complementary layers.** The Worker only runs
  for `/api/*` (`run_worker_first`), so it cannot add headers to the
  statically-served SPA document/JS/CSS/fonts. Those get a **`public/_headers`**
  file (Cloudflare static-assets convention; Vite copies it to the asset root)
  carrying a **CSP** plus HSTS, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, and `Permissions-Policy`. A Worker `app.use("*")` middleware
  sets nosniff / frame-deny / no-referrer / HSTS on everything *it* serves — the
  `/api/*` JSON, the image blobs, and the not-authorized page.
- **CSP is tuned to exactly what the built `index.html` loads**, not a generic
  template, and verified in a real browser (zero `securitypolicyviolation`
  events; fonts + inline `style` attributes + dnd-kit `.style.transform` all
  pass). `style-src` needs `'unsafe-inline'` because React `style={}` and
  dnd-kit drag transforms write inline styles; `script-src 'self'` is clean (the
  Vite build emits no inline scripts). CSP is deliberately **not** set by the
  Worker middleware: the not-authorized page uses inline `<style>` + Google
  Fonts, and the JSON API needs none.
- **`X-Content-Type-Options: nosniff` matters most for `/api/images`**, whose
  stored `Content-Type` is client-asserted and not magic-byte-checked — nosniff
  stops a browser from sniffing a mislabeled upload into something executable.
- **The OAuth callback now requires a Google-`verified` email** before the
  allowlist is consulted — defense-in-depth so an allowlist entry can never be
  satisfied by an unverified address. The allowlist (D44) remains the real gate.
- **`gitUrl` is validated server-side as an `http(s)` URL** on `POST`/`PATCH
  /api/repos`. The client renders it as a clickable link, so a `javascript:`
  (or `data:`) value would be a stored XSS vector on click.
- **The single-tenant trust model is affirmed, not changed.** Any allowlisted
  user (or the bearer token) can read all workspace data and all images; there
  is intentionally no per-resource ownership check, because every allowlisted
  account is trusted. Documented in REFERENCE so it reads as a decision, not a
  gap.
- **Vulnerability disclosure is published** as a repo-root `SECURITY.md` and an
  RFC 9116 `public/.well-known/security.txt` (canonical `https://progress.bck.dev`,
  served at `/.well-known/security.txt`). Low cost, and a fitting maturity signal
  for a develop-in-public portfolio repo whose public surface is the OAuth flow +
  webhook + health probe even though the app is allowlisted. The `security.txt`
  `Expires` field is mandatory and set ~1 year out (2027-07-01); it must be
  renewed before lapsing, since an expired file is worse than none.

*Deferred:* app-level rate limiting — the unauthenticated surface is minimal
(OAuth callback rejects on signed-state before any work; the webhook is
HMAC-gated; uploads are authenticated) and Cloudflare provides platform DDoS
protection, so this is defense-in-depth rather than a live risk.

### PROG-51 — auto-save drafts + write-failure resilience for comments & descriptions

Motivated by a real incident: a transient D1 "storage operation exceeded
timeout which caused object to be reset" error surfaced on `POST
/api/issues/:id/comments`, yet the comment had actually **committed** server-side
before the error returned (confirmed in prod). Two problems exposed: (1) typed
text is lost on a failed save (the composer cleared the draft before the server
confirmed), and (2) a naive auto-retry would **duplicate** a comment that
already landed, because the comment id was generated server-side.

**Decisions:**

- **Comment POST becomes idempotent via a client-supplied id.** The client now
  generates the `cmt_…` id (it already did for the optimistic row) and sends it
  in the body; the server validates the shape (`^cmt_[0-9a-f]{32}$`) and, if the
  id already exists, returns the existing row as success **only when it belongs
  to the same `authorId` and `issueId`** — otherwise `409`. This is the
  user-scoping guard (single-tenant trust model notwithstanding, D-security): a
  retry can never attach to, or reveal, another allowlisted user's comment. No
  migration — `id` is already the PK; the conflict is handled by a
  select-before-insert (safe at single-user, sequential-retry rates).
- **Drafts persist to localStorage, namespaced by the signed-in user.** Key
  shape `progress:draft:<kind>:<meId>:<targetId>` (kind = `comment` |
  `description`), written debounced as you type and cleared only on a
  server-confirmed save. Survives tab close / reload / accidental navigation.
  User-namespacing keeps drafts from leaking across allowlisted accounts that
  share a browser profile.
- **Failed writes auto-retry with backoff, then surface a persistent toast with
  a Retry action.** Comment sends retry ~2× (idempotent, so safe); on exhaustion
  the optimistic row is removed, the draft is preserved (and repopulated into the
  live composer if still mounted), and a non-auto-dismissing toast offers Retry
  (re-sends the same id → no duplicate). This extends the previously
  failure-only, auto-dismiss toast with an optional action + sticky variant.
- **Restored description drafts carry a subtle "unsaved draft" indicator.** A
  description draft is unsent text shown in place of the saved value, so silent
  restore could be mistaken for a saved edit; the editor reopens with the draft
  plus a small "Unsaved draft — discard" affordance. Description PATCH is already
  idempotent, so it needs no id key — only the draft + retry/Retry-toast
  treatment.

*Review hardening (PROG-51, same session):*

- **The composer clears on success only when the field still holds the sent
  text.** A second comment typed while the first (slow/retried) send was in
  flight was being wiped by the success handler — the exact silent loss this
  issue targets. `sendComment` now compares a live `draftRef` against the sent
  body and leaves a newly-typed comment untouched.
- **Container descriptions (product/repo/arc) get the same drafts + retry.** The
  shared `EditableMarkdown` was built for both issue and container descriptions,
  but `ContainerPage` hadn't opted in; it now passes `draftScope`, and
  `updateContainer` mirrors `updateIssue` (retry + returns confirmation +
  `toastOnError` opt-out) so the editor clears the draft only on a confirmed
  save.
- **The comment insert is race-safe via `onConflictDoNothing` + re-SELECT.** The
  earlier select-before-insert could let two same-id POSTs both pass the check
  and the loser hit a PK violation → unhandled 500 + Sentry noise. The insert now
  tolerates the conflict and, on an empty result, re-SELECTs and re-applies the
  author+issue ownership check to return a clean 200/409. A concurrent same-id
  race yields one 201 + one 200 and a single row.
- **Sticky Retry toasts dedupe by source key.** `toastAction` takes an optional
  `key` (`comment:<issueId>`, `description:<targetId>`); a repeat failure from the
  same composer replaces its toast rather than stacking duplicates on a
  retry-storm.
- **Two retry-backoff profiles.** A failed comment post shows nothing wrong on
  screen, so it retries harder (`[400, 1200]`) to recover transparently; a failed
  *field* mutation (status/priority/rename/rank/description) leaves the wrong
  value visible, so it retries once quickly (`[300]`) to cap that window, then
  reverts + Retry-toasts. The success path stays instant either way.

### PROG-124 — Outline capture view + sub-issues (one issue type, depth ladder)

A Workflowy-style outliner (`/outline`) for fast keyboard capture, confirmed via
`/interview-me` (see `docs/intent/outline-capture.md`). The model decisions:

- **Sub-issues are issues, not a new entity.** Issues gain a nullable
  self-referencing `parentIssueId` (migration `0008_issue_parent`); a sub-issue
  is simply an issue with a parent issue, nestable to unbounded depth. We
  explicitly rejected a "simple vs complex issue" split or a lightweight
  checklist-item table — the owner wants one data type with simplified *views*,
  not two models. Sub-issues keep their own key, status, priority, comments.
- **Same-product + acyclic invariants, API-enforced** (SQLite can't express
  them, like the existing repo/arc rules, D17): a parent must be in the same
  product as the child, and the parent chain must not cycle. Checked in
  `POST /api/issues` and `PATCH /api/issues/:id`.
- **Depth ladder; the root sets the ceiling.** The outline view scopes to a
  chosen Initiative *or* Product. Product root → `[Arc] → Issue → Sub-issue`;
  Initiative root → `Product → [Arc] → Issue → Sub-issue`. A fresh bullet is
  always an **Issue**; Arc and Product are never typed — they're reached by an
  explicit promote/assign command (pick existing or create new). Outdenting
  above the ceiling is disallowed. This keeps everyday capture (product scope)
  fast while letting structure be built when needed.
- **Reparent in place, no delete/archive here.** Indent/outdent rewrites
  `parentIssueId` (Tab/Shift-Tab between issue depths) and the explicit command
  rewrites `arcId`; both preserve issue identity, mirroring `moveIssue`. The
  outline view never deletes or archives an issue — that stays on the issue page
  (Backspace on an empty *unsaved* row just discards it).
- **Board "show sub-issues" toggle** (persisted, default off). Off: child issues
  are filtered out of the columns so the board stays one-card-per-deliverable.
  On: sub-issues render nested under their parent card with a distinct indented
  style. Reuses the existing `rank` for ordering; `parentIssueId` is orthogonal
  to `rank`.

### PROG-130 — search (two-wave instant + streamed comments)

Search over titles, descriptions, and comments, confirmed via `/interview-me`.
The decisions:

- **Title/description search is client-side; comments are server-side.** The
  workspace payload already holds every issue/container title + description
  (D20), so that half runs in memory and paints instantly — the hard instant-UI
  rule (SPEC §2.1) is preserved with no round-trip. Comments are the one
  searchable text *not* in the store (deliberately, D20 — unbounded growth), so
  they need a server query (`GET /api/search`). Results arrive in **two waves**:
  local hits immediately, comment hits a beat later in their own section, ranked
  below the local ones. The owner explicitly wanted comments included even in
  the quick modal, accepting the streamed second wave.
- **`LIKE`, not FTS5.** Matching is case-insensitive **substring** (the owner
  types the word they remember; fuzzy is out of the first cut). Substring is
  exactly SQLite `LIKE '%term%'`, whereas FTS5 is token/prefix-based and would
  *miss* a mid-word match like "ozzie" inside a longer token — so `LIKE` is both
  simpler (no virtual table, no sync triggers, no migration) and a better
  semantic fit. Wildcards in the query are escaped with an `ESCAPE '\'` clause so
  `100%` matches literally. A single owner over a bounded comment set makes the
  scan cheap; revisit only if it stops being so. Multi-word queries AND across
  whitespace terms; results cap at 50 with a `truncated` flag.
- **Ranking weights title over description.** A title hit outranks a
  description-only hit regardless of term count (weights 3 vs 1, +1 for a
  title-prefix match); ties break by recency. Comments always sort last by
  construction (separate section). Pure + unit-tested (`src/client/search.ts`,
  `src/worker/searchComments.ts`).
- **A separate `/` modal, not the ⌘K palette.** Despite the codebase's "exactly
  one keyboard-driven surface" value (CommandPalette header), search gets its own
  `/`-triggered modal — a search-focused result UI (weighted sections, comment
  snippets with highlighted matches, a streaming section) would have cluttered
  the command palette. The palette stays about commands + quick jump. The
  **`/search` page** is the deep dive: same results, filterable by the board
  dimensions, query + filters in the URL so a search is bookmarkable.
- **The streamed comments section shows a small spinner** while its request is
  in flight. This is a deliberate, narrow exception to the no-spinner rule: it's
  an inherent network search the owner opted into, and the *instant* (local) half
  never spins — only the comments sub-section indicates loading.

### PROG-75 — prevent impossible board filters

The board's filters form a hierarchy (Initiative → Product → Arc/Repo). Two gaps
let a user pick a combination that matches nothing: child dropdowns weren't fully
restricted by every ancestor, and changing an ancestor left stale child
selections in the URL. Both are now closed.

- **Dropdowns offer only reachable options.** Product was already limited to the
  chosen Initiative; Arc and Repo now also honour the Initiative (via their
  Product's `initiativeId`), not just the Product. So with only an Initiative
  set, the Arc/Repo lists already exclude containers from other Initiatives.
- **Changing an ancestor prunes stranded descendants in the same URL write.**
  A single pure helper, `pruneImpossibleFilters` (`src/client/boardFilters.ts`),
  runs inside `setParam`: pick a new Product and a now-foreign Arc/Repo is
  dropped; switch Initiative and a Product from elsewhere — plus its Arc/Repo —
  cascade away. Pruning the URL (the single source of truth) rather than just
  hiding options keeps the active selection and the offered options in sync, and
  keeps the result the same whether a filter changed via the dropdown or a deep
  link. Logic lives in the helper (unit-tested,
  `src/client/boardFilters.test.ts`) so the component stays declarative; this
  mirrors the existing split where pure filter logic is unit-tested and e2e
  covers browser-only behaviour (PROG-58).
- **Non-hierarchical filters (Tag, Priority) are untouched** — they're global
  vocabularies with no parent to constrain them.

### Arc work order — "copy as prompt" for a whole arc (combined-PR)

The issue "copy as prompt" / `get_bundle` work order (D33/D48) hands one issue
to an agent. The arc analogue hands a whole epic at once: the arc page gets a
**Copy arc as prompt** action that copies a single Markdown prompt covering
**every open issue** in the arc.

- **Open issues only.** "Open" = not terminal — `backlog`/`todo`/`in_progress`/
  `in_review`; `done` and `canceled` are dropped. Codified as
  `CLOSED_ISSUE_STATUSES` / `isOpenStatus` in `src/shared/constants.ts` so the
  rule is shared, not re-spelled per call site. The arc page's status *filter*
  is irrelevant to the copy — the server always selects the open set.
- **Full per-issue context, shared lineage once.** Each issue renders in the
  same shape as the issue bundle (fields, description, comments, an Images list,
  linked PRs/commits) minus its per-issue report-back footer; product/arc
  lineage is stated once up top, with repo per-issue (issues in one arc can
  target different repos). Sorted status-then-number for a deterministic,
  byte-stable render, like `renderBundle`.
- **One combined PR, not a PR per issue.** The arc footer's orchestration
  deliberately *diverges* from the per-issue preamble: it tells a lead agent to
  fan the issues out to **sub-agents**, share **one feature branch**, and land
  everything in a **single PR naming every issue key**. The smart-commit block
  (D48) carries over, keyed per-commit to the issue it advances; the
  merge-collision guidance is sharpened because sub-agents now edit one branch
  at once.
- **New surfaces.** `GET /api/arcs/:id/bundle` (by internal id — the arc page has
  it; mirrors the issue endpoint's reads), `renderArcBundle` in
  `src/worker/bundle.ts`, and `copyArcBundleAsPrompt` / `prefetchArcBundle` in
  `src/client/workOn.ts` (the bundle cache is now namespaced `issue:`/`arc:`).
  Prefetched on arc-page mount and when the arc's issues change, so the copy is
  instant. Scoped to the in-app surface for now — MCP/CLI arc kickoff is a
  later, separable step.

### PROG-77 — Outline: dim completed issues, sticky "Hide done" toggle

The Outline showed every issue with no signal for completion. Two changes, no
new nouns:

- **Completed issues stay visible but read as finished.** Done/canceled rows
  render dimmed (`text-ink-faint`) and struck through (`line-through`), reusing
  the same archived-row idiom from Structure/Archive. Completion is keyed off the
  shared `isOpenStatus` helper (constants.ts), so "completed" means done **or**
  canceled — not a new outline-only notion.
- **A page-level "Hide done" toggle removes them entirely.** When on, the forest
  is built from `issues.filter(isOpenStatus)` — a hidden parent never recurses,
  so its whole subtree drops with it (acceptable: hiding done hides finished
  branches). Capture/indent/outdent math still runs off the full `issues` list,
  so what's visible never changes nesting behavior.
- **The toggle is a sticky per-user preference.** Persisted to `localStorage`
  (`src/client/outlinePrefs.ts`, key `progress:outline-hide-done`) and re-seeded
  on mount, so it survives navigating away and back — mirroring the sticky
  board-filters pattern (D-PROG-58/boardFilters.ts) but simpler: a bare boolean,
  not URL-backed, because the outline scope (not this toggle) is what belongs in
  the URL. Single-user app, so one global key (no per-user namespacing), and
  every storage access fails soft.
