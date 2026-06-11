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
