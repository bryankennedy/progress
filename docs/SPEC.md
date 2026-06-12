# Progress — Product Spec & Roadmap

> The **why** (vision, principles) and the **what remains** (plans, in
> deliberate future tense). The system as built is documented in
> [`REFERENCE.md`](./REFERENCE.md); rationale lives in
> [`DECISIONS.md`](./DECISIONS.md). Section numbers here are stable — code
> comments and decision entries cite them — so shipped sections shrink to
> intent + a pointer rather than being renumbered away.

## 1. Vision

**Progress** is a personal product-development tracker — a single-user
Linear-class tool whose hierarchy and vocabulary match how its owner actually
thinks about work.

It is **not** a personal to-do app. The domain is building products:
initiatives, products, repos, and the issues that move them forward.

The core insight: existing tools (Linear, Jira, GitHub Issues) fail not on
features but on **nouns**. Their hierarchies don't match the owner's mental
model, and the constant translation is friction. Progress makes the hierarchy
itself the product.

### Who it's for

One user (the owner) in v1. The data model anticipates collaborators later
(creator/assignee/author fields exist from day one), but no auth,
permissions, or sharing UI ships in v1.

## 2. Product principles

1. **Speed is a feature, not an optimization.** Every interaction must feel
   instant, achieved architecturally (§8.2), not by tuning later. No spinner
   ever appears as a result of a user mutation.
2. **Rigid simplicity over configurability.** Linear's philosophy, not
   Jira's. One fixed status set, one way to do things. Configuration is a
   cost, not a feature.
3. **Your nouns, exactly.** Initiative → Product → Repo/Arc → Issue. No
   translation layer between the tool's language and the owner's. ("Epic"
   and "project" are banned words.)
4. **Paper-y, open UI.** The look of Linear crossed with the open-page feel
   of Notion. Light, calm, high-contrast, typography-led. Mobile-friendly
   from v1.

## 3. Domain model

✅ **Shipped** (milestones 2–5). The hierarchy, containment and movement
rules, derived issue keys with permanent aliases, archive-not-delete, and
the full issue anatomy are implemented as specced and documented in
[REFERENCE §2](./REFERENCE.md#2-domain-model). Decisions: D17–D19, D24,
D26–D27.

## 4. Views & UX

✅ **Shipped** (milestones 3–5). The global "My Work" kanban with URL-param
filters and drag-and-drop, container pages with inline editing, the full
issue page, the ⌘K command palette, and the single-key action map are
documented in [REFERENCE §5](./REFERENCE.md#5-ui-surfaces). Decisions:
D22–D23, D25.

Still open from this section's original scope:

- **Mobile**: the layouts use responsive primitives, but the "genuinely
  works on a phone" pass (board scroll behavior, issue page reflow,
  touch-target sizes) hasn't been deliberately done or verified — it rides
  with the deploy milestone.

## 5. Git integration — *next milestone*

- **Mechanism:** a GitHub webhook (push + pull_request events) per connected
  repo (repos already store `gitUrl`).
- **Magic words:** mentioning an issue key (`PROG-123`) in a **branch name,
  commit message, or PR title/body** auto-links that commit/PR to the issue.
  Retired alias keys must resolve too.
- **Display:** linked PRs (with open/merged/closed state) and commits appear
  on the issue page and in its activity feed (the `activity.data` payload
  was designed for this, D19).
- **Explicitly not in v1:** status automation (PR opened → In Review,
  merged → Done) — deferred to v1.x. GitHub Issues sync — non-goal, likely
  forever.
- The webhook endpoint authenticates via GitHub's HMAC signature and
  bypasses Cloudflare Access (§8.3).
- **Re-prioritized up** (D28): branch-from-key linking is the loop-closer
  for the Claude Code integration (§11), so this ships before the agent
  work, right after v1 core.

## 6. v1 scope — status

| ✅ Built | 🔜 Remaining for v1 | Out (non-goals) |
|---|---|---|
| Full hierarchy: Initiative / Product / Repo / Arc / Issue | GitHub webhook magic-word PR/commit linking (§5) | GitHub Issues sync |
| Fixed statuses, priority, estimate, global tags | Mobile-friendly verification pass (§4) | Configurable workflows |
| Global "My Work" kanban with filters | Production deploy + Cloudflare Access (§8.3) | Time tracking |
| Container pages + issue page, Markdown everywhere | The dogfood cutover (§7) | Native mobile apps |
| Comments + activity feed | | |
| Issue creation, movement with key-alias redirects | | |
| Container CRUD + archive, tag management | | |
| Command palette + keyboard actions | | |

Deferred to v1.x: sprints & cycles · multi-user & sharing · notifications ·
status automation from PRs · due dates, sub-issues, blocking relations ·
saved custom views · per-container boards (URL-param filters cover them) ·
**API for third-party clients — planned as the MCP surface (§11)**.

## 7. The dogfood milestone

v1 is "done" when Progress's own backlog moves out of `docs/` and into
Progress itself, running in production, and managing the development of
v1.x.

## 8. Architecture

### 8.1 Stack

✅ **Shipped** as specced — see [REFERENCE §1](./REFERENCE.md#1-stack--layout)
for the live table (Workers + D1 + Hono + React/Vite/Tailwind + TanStack
Query, Bun tooling). Decisions: D10, D15–D16, D21.

### 8.2 The speed architecture (standing requirement)

Jira's lag is architectural, not framework-imposed — Linear is React and
feels instant. Progress copies the pattern at a scale where it's easy, and
every future feature must preserve it:

1. **Load everything up front.** The whole workspace loads into the client
   store on app start; everything renders from memory thereafter.
2. **Optimistic mutations.** Every action updates the local store
   synchronously and syncs in the background; failures roll back with a
   toast.
3. **No interaction spinners.** A spinner after a click is a build failure,
   not a UX choice. Initial app load is the only permitted loading state.
4. **Stay fast by staying small.** Keep the dependency budget tight; measure
   interaction latency as part of review (baseline in
   [REFERENCE §6](./REFERENCE.md#6-performance-baseline)).

### 8.3 Auth & security — *not yet set up*

- **Cloudflare Access** in front of the entire app — login with the owner's
  identity; the app itself contains no auth code in v1.
- The GitHub webhook route (§5) will be excluded from Access and instead
  verify GitHub's `X-Hub-Signature-256` HMAC.
- A Cloudflare Access **service token** will cover non-interactive clients
  (the §11 MCP/bundle surface) — same bypass pattern as the webhook.
- All secrets via environment (`wrangler secret` in production, `.env`
  locally, never committed). `.env.example` documents required keys.

### 8.4 Data notes

✅ **Shipped** — id conventions, derived keys + alias table, append-only
activity, multi-user-ready schema: [REFERENCE §2](./REFERENCE.md#2-domain-model).

## 9. Open questions

All v1 open questions are closed: estimate scale → points (D19) · Backlog
behind a toggle → yes (D23) · tag UX → minimal name + auto-color (D27) ·
client store library → TanStack Query, by latency spike (D21). New questions
should be added here and closed into `DECISIONS.md`.

## 10. Beyond v1 (direction, not commitment)

Sprint planning on top of the existing model · per-container boards · saved
views · PR-driven status automation · notifications/digests · multi-user ·
**Claude Code agent integration (§11 — the headline v1.x feature)**.

## 11. Claude Code integration (v1.x direction — design now, build after v1)

The owner's development workflow runs through Claude Code. Progress should
close the gap between *tracking* work and *executing* it: an issue carries
enough context (description, comments, arc, product, repo + git URL, linked
PRs) to be an **executable work order**, not just a record.

### 11.1 The context bundle (shared foundation)

A deterministic Markdown rendering of an issue and its surroundings, served
as `GET /api/issues/:key/bundle`:

- Issue: key, title, description, status, priority, estimate, tags.
- Lineage with descriptions: product → repo (incl. `gitUrl`) → arc — the arc
  description is where epic-level intent lives, so the agent sees the *why*.
- Comments (the owner's running notes are usually the freshest context) and
  linked PRs/commits once §5 ships.
- A stable preamble telling an agent how to report back (post a comment,
  update status, mention the key in branch/commit for auto-linking).

One format feeds both directions below; it is also just a useful "copy as
prompt" button for manual use.

### 11.2 Outbound — execute an issue from Progress

A "Work on this" action on an issue (palette command + button) that starts a
Claude Code session primed with the bundle:

- v1.x minimal: copy/handoff — a generated one-liner (e.g.
  `progress work PROG-123`, a small CLI/script that fetches the bundle and
  launches `claude` with it in the right checkout) keeps Progress free of
  machine-specific knowledge about where repos live.
- Later: launch a cloud/headless Claude Code session directly from the web
  UI against the repo's `gitUrl`, working in a branch named from the issue
  key (e.g. `iss/PROG-123`).
- Branch-from-key is the linchpin: it makes §5 magic-word linking automatic,
  so agent work flows back into the issue's activity with zero ceremony.

### 11.3 Inbound — interrogate Progress from Claude Code

Progress exposes an **MCP server** (the Worker already hosts the API; MCP is
the natural "API for third-party clients" from §6, promoted from deferred):

- Tools: get issue/bundle by key, list/filter issues ("my todo in this
  repo"), update status, comment, create issues, move issues.
- The owner says "work on PROG-123" in any Claude Code session; the agent
  pulls the bundle, does the work, posts progress comments, and flips status
  — the same fixed status set keeps agent updates unambiguous.

### 11.4 Prerequisites & sequencing

1. **Production deploy** (§7/§8.3) — agents need a stable URL.
2. **Non-interactive auth**: a Cloudflare Access service token (same pattern
   as the webhook's HMAC bypass) for the bundle/MCP surface; secrets via
   env per §8.3.
3. **§5 webhook linking** — without it the loop doesn't close; with it,
   agent branches/PRs appear on the issue automatically. Build it first.

Roadmap impact: webhook (next) → mobile + deploy + dogfood (v1 done) →
context bundle + MCP server → outbound work-session kickoff.
