# Progress — Reference

The system **as built** (milestones 1–5, 2026-06-11/12). Information-oriented
and present tense throughout; if it's described here, it works today. For
vision and unbuilt work see [`SPEC.md`](./SPEC.md); for rationale see
[`DECISIONS.md`](./DECISIONS.md) (D-numbers below refer to its entries).

## 1. Stack & layout

| Layer | Choice |
|---|---|
| Hosting | Cloudflare Workers (single Worker: API + static assets) — production at <https://progress.bck.dev>, D1 `progress-db` (ENAM) |
| API | Hono (TypeScript, ESM) |
| Database | Cloudflare D1 (SQLite) via Drizzle ORM; local D1 under `.wrangler/state/` |
| Frontend | React 19 + Vite + Tailwind 4 |
| Client state | TanStack Query, whole workspace in one cache entry (D21) |
| Routing | wouter (D22) |
| Drag & drop | @dnd-kit/core + @dnd-kit/sortable (D23, D44) |
| Markdown | react-markdown + hand-rolled `.prose-lite` styles |
| Tooling | Bun (packages & scripts), Node 22 LTS, TypeScript strict, ESM |

| Path | Purpose |
|---|---|
| `src/worker/index.ts` | The whole Hono API |
| `src/client/` | React app (`main.tsx` entry, `pages/`, `commands/` = palette/dialogs/keys) |
| `src/client/store.ts` | Client store: workspace cache + every optimistic mutation |
| `src/shared/` | Wire types (`types.ts`) and fixed vocabularies (`constants.ts`) shared client/server |
| `src/db/schema.ts` | Drizzle schema — single schema source of truth, generates `drizzle/` migrations |
| `src/mcp/server.ts` | Progress MCP server — local stdio client of the API (D34) |
| `bin/progress.ts` | `progress work <KEY>` kickoff CLI — bundle → branch → `claude` (D35) |
| `scripts/` | `seed.sql` (idempotent baseline), `seed-scale.ts` (5k-issue synthetic workspace) |

## 2. Domain model

```mermaid
graph TD
    I["Initiative"] --> P["Product"]
    P --> R1["Repo"]
    P --> A["Arc"]
    P -->|direct| X1["Issue"]
    R1 --> X2["Issue"]
    A -.groups.-> X1
    A -.groups.-> X2

    classDef initiative fill:#CDEEF9,stroke:#06A7E0,color:#000
    classDef product fill:#FBE4C9,stroke:#F08B23,color:#000
    classDef repo fill:#FBF0C8,stroke:#F2C42E,color:#000
    classDef arc fill:#E8DBEE,stroke:#BA94C4,color:#000
    classDef issue fill:#D7DEF0,stroke:#546EB4,color:#000

    class I initiative
    class P product
    class R1 repo
    class A arc
    class X1,X2 issue
```

| Entity | Parent | Notes |
|---|---|---|
| Initiative | — | Portfolio-level theme grouping products. |
| Product | Initiative | The central unit; carries the issue-key prefix (`keyPrefix`, 2–8 letters, globally unique, editable) and the per-product issue-number sequence (`nextIssueNumber`). |
| Repo | Product | Sub-container mirroring a real git repository (`gitUrl`, optional until connected). |
| Arc | Product | Epic-like grouping of issues from anywhere under its product. (The words "epic" and "project" are banned.) |
| Issue | Product *or* Repo | The atomic unit. `productId` always set; nullable `repoId` narrows the container (D17). Optional `arcId`, same-product enforced. |
| Tag | — (global) | Name + auto-color (stable hash into a fixed 7-color palette, D27). |

### Containment & movement rules (as enforced)

- An issue's container is a product or one of that product's repos — never
  both, never neither. Repo-in-product and arc-in-product invariants are
  API-enforced (SQLite can't express them cheaply).
- Issues move freely between containers. **Within a product**: the key and
  arc survive; only `repoId` changes. **Across products**: the issue is
  re-keyed from the target's sequence, its arc is cleared, and the old key
  is written to `issue_key_aliases` as a permanent redirect (D18, D24).
- Issue keys are **derived, never stored**: `product.keyPrefix + "-" +
  issue.number`. Renaming a prefix re-keys everything consistently; alias
  rows store retired keys verbatim so they survive renames too.
- **Archive, no hard deletes** — all four container types carry
  `archivedAt`. Archived containers leave board filters, creation targets,
  move targets, and palette search; their issues stay visible everywhere;
  parent pages list them dimmed so unarchive stays reachable (D26).

### Issue anatomy

| Field | Values |
|---|---|
| Key | `PREFIX-n`, derived (see above) |
| Title, Description | text / Markdown, both inline-editable |
| Status | `backlog` · `todo` · `in_progress` · `in_review` · `done` · `canceled` — fixed global set |
| Priority | `urgent` · `high` · `medium` · `low` · `none` (default `none`) |
| Estimate | 0 / 1 / 2 / 3 / 5 / 8 points, or null |
| Due date | Optional calendar day, ISO `YYYY-MM-DD` (timezone-safe, not an instant); drives the Agenda (D37) |
| Board order | `rank` — a fractional-index key (`src/shared/rank.ts`) giving each card a manual vertical position in its column; drag a card above/below another. Always set; one-row reorder, no renumbering (D44) |
| Tags | 0..n global tags |
| Arc | 0..1, same product |
| Comments + Activity | Markdown thread interleaved with append-only events into one timeline |
| Timestamps | `createdAt`, `updatedAt`, `completedAt` (set iff status is `done`) |
| Creator / assignee | user references (one `usr_owner` row in v1; schema is multi-user-ready, D13) |

Fixed vocabularies live in `src/shared/constants.ts` and are shared verbatim
by schema, API validation, and client.

### Data conventions (D19)

- IDs: app-generated text with type prefixes — `usr_ ini_ prd_ rep_ arc_
  iss_ tag_ cmt_ act_` — identifiable on sight in URLs and logs.
- Container and tag ids may be **client-generated** (the store creates rows
  optimistically and navigates immediately; the server accepts well-formed
  ids verbatim, D26).
- Timestamps: unix-epoch integers set by the API, never DB defaults. The
  exception is `issues.due_date` (D37): a **calendar day** stored as ISO
  `YYYY-MM-DD` text, identical in every timezone — deliberately not an instant.
- Activity rows are append-only; `data` carries the event payload. Current
  event types: `status_changed` `{from, to}`, `moved` `{fromProductId,
  fromRepoId, toProductId, toRepoId, fromKey?, toKey?}` (keys present only
  on cross-product moves), `pr_linked` `{githubRepo, prNumber, title, url,
  state}`, `commit_linked` `{githubRepo, sha, message, url, branch}`.

### Git links (D29)

Two tables, written only by the GitHub webhook: `pr_links` (PK `issueId +
githubRepo + prNumber`; mutable `state` open/merged/closed and `title`) and
`commit_links` (PK `issueId + sha`; immutable, message stored as subject
line only). `githubRepo` is `"owner/name"` text, deliberately **not** an FK
to `repos` — links survive container renames/archives and can arrive from
repos that aren't containers here. Composite PKs double as the idempotency
guard for webhook redeliveries. Links are permanent: editing the mention
away later does not unlink.

## 3. API

All routes are JSON under `/api`. Errors are `{ error: string }` with 400
(validation), 401 (unauthenticated), 403 (not on the sign-in allowlist), 404
(missing), or 409 (key-prefix conflict). Any uncaught handler error is caught by
a top-level `app.onError`: it logs the real exception (`console.error`, visible
in `wrangler tail`) and returns a generic `{ error: "internal_error" }` 500 —
generic on purpose, since the webhook path is publicly reachable (D31).

### Authentication (PROG-34, supersedes D12)

The Worker owns auth: in-app **Google OAuth** mints a stateless signed session
cookie, and a middleware on `/api/*` resolves identity per request — exempting
`/api/health`, `/api/auth/*`, and `/api/webhooks/*`. Order: an
`Authorization: Bearer <PROGRESS_API_TOKEN>` header (non-interactive clients →
`usr_owner`); else a valid `progress_session` cookie; else, **when the OAuth
secrets are unset _and_ the request is to a loopback origin** (local dev), a
fallback to `usr_owner` so `bun run dev` and tests never hit a login wall; else
`401`. The loopback condition makes the fallback fail **closed**: a deployed
origin with unconfigured auth returns `401` rather than silently serving the API
as the owner. Every write is attributed to the
resolved user (`c.get("userId")` → `creatorId`/`assigneeId`/`authorId`/
`actorId`); the webhook, having no interactive user, still writes as `usr_owner`.
Sign-in is gated two ways (D44): **super-admins** (the `SUPER_ADMIN_EMAILS`
secret) are always allowed and manage everyone else via the **Admin** page
(`/admin`); other users must have a row in the D1 `allowed_emails` table. The
check `super-admin OR allowlisted` runs at the OAuth callback **and** on every
`/api/*` request, so removing someone revokes their live session within seconds
(the middleware drops the cookie and returns `401`). Admin CRUD lives at
`/api/admin/allowlist` gated on a per-request `isSuperAdmin` flag; `/api/workspace`
ships `isSuperAdmin` + the `allowedEmails` list to super-admins only.
Auth routes: `GET /api/auth/login` (302 → Google, sets a signed state cookie),
`GET /api/auth/callback` (verify state, exchange code, allowlist-check, upsert
user by email, set session cookie, 302 → `/`), `POST /api/auth/logout`. See
`src/worker/auth.ts`. Client-side, a `401` from `GET /api/workspace` surfaces as
an `UnauthenticatedError` that renders the **sign-in landing page**
(`SignIn.tsx`, §5) — a brand mark and a "Sign in with Google" button linking to
`/api/auth/login` — rather than auto-redirecting.

### Observability

Every request is tagged with a `requestId` (Cloudflare's `cf-ray` in prod, a
uuid locally), echoed as the `x-request-id` response header. The Worker logs
**structured JSON** (`src/worker/log.ts`): a `request` access line per `/api/*`
call (`method`/`path`/`status`/`durationMs`, excluding `/api/health`) and error
events (`unhandled_error`, `oauth_callback_failed`, `health_d1_probe_failed`)
carrying the same `requestId`. `observability` is enabled in `wrangler.jsonc`, so
the logs are queryable in the dashboard. Operational detail — tailing, querying,
and alert setup — is in `docs/SETUP.md` §6.

### Workspace & issues

| Route | Behavior |
|---|---|
| `GET /api/health` | Readiness probe: round-trips D1 (`select 1`). `{ ok: true, db: "ok" }` (200) when reachable, `{ ok: false, db: "error" }` (503) when not — so it reflects database reachability, not just that the Worker booted. The only `/api/*` route never access-logged. |
| `GET /api/workspace` | The load-everything payload: `me` (the signed-in user, PROG-34), users, initiatives, products, repos, arcs, issues, tags, issueTags, issueKeyAliases — nine independent reads run with `Promise.all` (not a `db.batch`/transaction, which 500'd on production D1; D31). Comments/activity are deliberately excluded (D20). |
| `POST /api/issues` | `{ title, productId, repoId?, arcId?, description?, status?, priority?, estimate?, dueDate? }` → 201 `{ issue }`. `dueDate` is `YYYY-MM-DD` or null, validated (impossible dates rejected). Number allocated by atomic increment of the product sequence; gaps from failed creates are harmless (D24). A board `rank` is auto-assigned, appended after the current last issue (D44). |
| `PATCH /api/issues/:id` | Any of `title, description, status, priority, estimate, arcId, dueDate, rank` — validated per field; arc must be same-product; `dueDate` is `YYYY-MM-DD` or null to clear. `rank` is a fractional-index board key the client computes from the drop site's neighbors (D44). A status change atomically appends a `status_changed` activity row and maintains `completedAt`. |
| `POST /api/issues/:id/move` | `{ productId, repoId }` (`repoId: null` = product-level). Within-product keeps key + arc; cross-product re-keys, clears arc, writes the alias, logs `moved`. 400 on no-op. |
| `GET /api/issues/:id/timeline` | `{ comments, activity, pullRequests, commits }`, each ordered by `createdAt`. |
| `GET /api/issues/:key/bundle` | Looked up by **key** (alias-aware), not id. Returns `text/markdown` — a deterministic context "work order": issue fields + tags, lineage with descriptions (product → repo incl. `gitUrl` → arc, where the arc description carries the "why"), comments, an **Images** list (absolute URLs of every image referenced in the description/comments, so a bearer-authed agent can fetch them — PROG-42), linked PRs/commits, then a stable report-back preamble. A retired key resolves and renders the current canonical key. 400 malformed key, 404 unknown. Shared foundation for the agent surfaces (SPEC §11.1, D33). |
| `POST /api/issues/:id/comments` | `{ body }` → 201 `{ comment }`. |

### Images (PROG-42)

Pasted/uploaded images live in the R2 bucket bound as `IMAGES`; a D1 `images`
row authorizes and attributes each. Both routes sit behind the `/api/*` auth
gate, so an image is viewable by any signed-in (allowlisted) user or the bearer
token — never the public internet.

| Route | Behavior |
|---|---|
| `POST /api/images` | Raw image bytes as the body (`Content-Type` = the image type). Validates type (png/jpeg/gif/webp/avif) + size (≤10 MB), stores to R2, records the row → 201 `{ image: { id, url } }` where `url` is `/api/images/<id>`. |
| `GET /api/images/:id` | Streams the blob with an immutable cache header. `?w=<px>` returns an edge-resized variant via a `cf.image` subrequest **in production**; locally / off-edge / with resizing disabled it streams the original (graceful fallback). `?raw=1` always streams the original. |

Descriptions/comments reference images as `/api/images/<id>` markdown; the shared
`Markdown` renderer requests a `?w=` display variant and links to the original,
and `MarkdownTextarea` handles paste + the "+ Image" button in both editors.

### Tags

| Route | Behavior |
|---|---|
| `POST /api/issues/:id/tags` | `{ tagId }` assigns an existing tag; `{ name, id? }` creates-or-gets by name (auto-color) then assigns — one atomic call (D27). Link insert is idempotent. → 201 `{ tag, link }`. |
| `DELETE /api/issues/:id/tags/:tagId` | Unlinks. Tag rows are never deleted. |

### Containers (D26)

| Route | Behavior |
|---|---|
| `POST /api/initiatives` | `{ id?, name, description? }` |
| `POST /api/products` | `{ id?, name, initiativeId, keyPrefix, description? }` — prefix validated `^[A-Z]{2,8}$` (uppercased), 409 if taken |
| `POST /api/repos` | `{ id?, name, productId, gitUrl?, description? }` |
| `POST /api/arcs` | `{ id?, name, productId, description? }` |
| `PATCH /api/<type>/:id` | `{ name?, description?, archived? }` for all four; plus `keyPrefix?` (products), `gitUrl?` (repos). `archived: boolean` maps to `archivedAt`. |

All return `{ container }`; creates return 201.

### GitHub webhook (D29)

`POST /api/webhooks/github` — authenticated by GitHub's
`X-Hub-Signature-256` HMAC (SHA-256 over the raw body, constant-time
compare) against the `GITHUB_WEBHOOK_SECRET` binding (local: `.dev.vars`;
production: `wrangler secret put`). 503 when unconfigured, 401 on a bad
signature; unhandled events are acknowledged with `{ ok, ignored }`.

Magic words: candidates matching `\b[A-Za-z]{2,8}-\d+\b` are resolved
against current issue keys first, then retired alias keys; unknown prefixes
simply don't resolve (so prose like "UTF-8" can't false-positive).

- **`push`**: keys in the branch name link every commit in the push; keys
  in a commit message link that commit. New links append `commit_linked`
  activity; redeliveries are no-ops.
- **`pull_request`**: keys in the title, body, or source-branch name link
  the PR. First sight inserts the link + `pr_linked` activity; later events
  (edit/close/merge/reopen) update title and state in place, silently.
  GitHub's closed+merged flag is normalized to the `merged` state.

### MCP server (D34)

`src/mcp/server.ts` (`bun run mcp`) is a **local stdio MCP server** that wraps
this API rather than re-implementing the domain — the Worker stays the single
source of truth. It authenticates with the **`PROGRESS_API_TOKEN`** bearer
(or the `PROD_PROGRESS_API_TOKEN` fallback) via the `Authorization: Bearer`
header, the same non-interactive pattern the dogfood scripts and `progress work`
CLI use (SPEC §11.3/§11.4, PROG-34). Registration: SETUP §7.

Tools are **key-addressed** (alias-aware) and validated against the shared
vocabularies in `src/shared/constants.ts`:

| Tool | Wraps |
|---|---|
| `get_bundle` | `GET /api/issues/:key/bundle` — the Markdown work order |
| `get_issue` | one issue as structured JSON (fields + lineage names + tags) |
| `list_issues` | filters `GET /api/workspace` in-process: `status, productKey, repo, arc, tag, query, limit` (AND-combined; default limit 50) |
| `create_issue` | `POST /api/issues` (arc/repo by name, resolved within the product; optional `dueDate`) |
| `update_status` | `PATCH /api/issues/:id` `{ status }` |
| `set_due_date` | `PATCH /api/issues/:id` `{ dueDate }` — set a `YYYY-MM-DD` day or clear with null |
| `comment` | `POST /api/issues/:id/comments` |
| `move_issue` | `POST /api/issues/:id/move` (destination product by key) |

Key→id resolution and name lookups run off one `/api/workspace` snapshot per
call, mirroring the Worker's own alias-aware resolution (retired keys resolve;
results report the current canonical key).

### Work-on-this kickoff (D35)

Two ways to hand an issue's bundle to a Claude Code session (SPEC §11.2):

- **In-app** — the issue page's **Work on this** field and the `W` palette
  command (`src/client/workOn.ts`) copy either the bundle Markdown ("Copy as
  prompt") or the `progress work <KEY>` CLI line. The bundle is fetched from
  `GET /api/issues/:key/bundle` and prefetched on issue load so the copy is
  instant (no spinner; SPEC §8.2).
- **CLI** — `bin/progress.ts` (`progress work <KEY>`): fetches the bundle with
  the `PROGRESS_API_TOKEN` bearer, creates/checks out `iss/<KEY>` (branch-from-key, so
  later commits/PRs auto-link via §5), then launches `claude` primed with the
  bundle as its opening prompt — all in the current directory, so Progress
  never needs to know where repos live. Flags: `--no-branch`, `--print`.
  Registration: SETUP §7.

## 4. Client architecture

### The store (`src/client/store.ts`)

- One TanStack Query cache entry `['workspace']` holds the entire workspace,
  fetched once with `staleTime: Infinity` — this client is the only writer,
  so nothing goes stale on its own (D21). Components subscribe to slices via
  `useWorkspaceSlice`; structural sharing keeps re-renders scoped.
- Per-issue timelines are separate `['issue', id, 'timeline']` queries,
  loaded when an issue page opens and invalidated by mutations that append
  activity.
- **Every mutation is optimistic** (SPEC §8.2 is a hard requirement): write
  the cache synchronously, sync in the background, and on failure restore
  exactly the touched state and raise a toast. No interaction ever waits on
  the server:
  - Field updates snapshot/restore the one issue or container.
  - **Creates allocate identity locally** — issue numbers from the store's
    `nextIssueNumber` mirror, container/tag ids generated client-side — so
    navigation to the new entity is instant and survives reconciliation
    with the server row.
  - **Moves** mirror the full server semantics locally, including the
    cross-product re-key and alias append, so an open issue page redirects
    to its canonical key with no round trip.

### Routing & key resolution

Routes: `/` (board), `/agenda` (the due-date view), `/structure` (the
container tree), `/issue/:key`, `/initiative/:id`, `/product/:id`,
`/repo/:id`, `/arc/:id`. Issue URLs are key-based; `findIssueByKey` resolves
current keys first, then alias keys with a `replaceState` redirect to the
canonical key — entirely client-side from the loaded workspace (D22).

## 5. UI surfaces

- **Sign-in landing (`SignIn.tsx`)** — the only screen rendered without a loaded
  workspace (on a `401`, PROG-34): centered brand mark, "Progress" wordmark, and
  a single **Sign in with Google** link to `/api/auth/login`. No header, no store
  access. In local dev the Worker falls back to the owner, so this appears only
  when OAuth is configured (production).
- **App header** — persistent across pages: the "Progress" home link, nav
  (Board · Agenda · Structure), and a **New** menu (Issue · Initiative ·
  Product · Repo · Arc) that opens the existing optimistic create flows. The
  always-available structure-creation entry point (SPEC v2 §4).
- **Agenda (`/agenda`)** — the time-driven cut: every issue with a due date
  that isn't done/canceled, sorted by due date ascending and grouped **Overdue ·
  Today · This week · Later** (computed from the owner's local day; "this week"
  is a rolling 7 days, D38). Each row carries the **priority indicator** (§7.2 /
  D39), key, title, the due date as a relative phrase ("in 3 days"), product/arc
  and status; overdue rows are visually distinct. Filterable by product/arc/tag
  via URL params (the board pattern), with inline mark-done and bump-due. Renders
  entirely from the store.
- **Structure (`/structure`)** — the Initiative → Product → (Repo · Arc) tree
  with an inline "+ add" on each node (D40); a dedicated home for curating
  structure that keeps the board uncluttered.
- **Board (`/`)** — the global "My Work" kanban. Columns are the fixed
  statuses; Backlog hides behind a toggle by default. Filters (initiative,
  product, repo, arc, tag, priority) live in URL query params, so any
  filtered board is bookmarkable — this is how per-container boards are
  covered without existing (D23). The current filter selection is also
  mirrored to `localStorage` (`progress:board-filters`) and re-applied when the
  board is reopened with a bare URL, so a choice sticks across navigation;
  "Clear filters" clears the memory too (PROG-58). Drag-and-drop reorders cards
  vertically
  within a column (a manual work order) and moves them between columns to set
  status; both persist as one optimistic write via the card's `rank` (D44).
  Mouse drags activate after 4px of movement (plain clicks navigate), touch
  drags after a 250ms press-and-hold (plain swipes scroll the board) — D30.
- **Container pages** — description-on-top open page (inline-editable name,
  Markdown description, key prefix / git URL where applicable, archive
  toggle), child-container chips with "+ New" buttons, and a
  sortable/filterable issue list with inline status/priority edits.
- **Issue page** — inline-editable title and description, sidebar fields
  (status/priority/estimate selects; container, arc, and tags with picker
  buttons; a **Work on this** field — D35), a Git section (linked PRs with
  state badges, commits with short shas, linking out to GitHub), and comments
  + activity interleaved into one timeline.
- **Command palette** — one keyboard surface (D25): root mode searches
  issues by key (retired alias keys included) or title and containers by
  name, and lists commands (create issue/initiative/product/repo/arc,
  pickers for the current issue). Picker modes are filterable lists; tag
  toggles keep the palette open for multi-edit.
- **Create dialogs** — issue and container creation; parents/containers
  default from the current view (open container page, viewed issue's
  container, or active board filters). New issues default to **Todo** so
  they're visible on the default board, and carry an optional **due date**. The
  issue dialog offers inline **"+ New product / + New arc"** so structure can be
  spun up without leaving the flow (SPEC v2 §4).

### Keyboard map (D25, D27)

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette |
| `C` | Create issue |
| `S` / `P` / `E` | Status / priority / estimate picker for the current issue |
| `M` / `A` / `T` | Move / arc / tag picker for the current issue |
| `D` | Due-date picker for the current issue (relative quick-picks or a typed `YYYY-MM-DD`; clear) |
| `W` | Work on this — copy the bundle as a prompt or the `progress work` CLI line (D35) |
| `↑↓`, `Enter`, `Esc`, `Backspace` | Navigate / run / close / back-to-root inside the palette |

"Current issue" = the issue page's issue, or the card/row under the pointer
or keyboard focus on boards and lists (tracked via `data-issue-id`
delegation). Plain keys are suppressed while typing in any input.

## 6. Performance baseline

The architecture was validated by a latency spike before adoption (D21):
5,000-issue synthetic workspace, 100 real DOM clicks in headless Chromium —
TanStack Query at 23 ms p50 / 98 ms p95 click-to-paint on the worst-case
all-columns board. Regenerate the dataset with `bun run db:seed:scale`.
