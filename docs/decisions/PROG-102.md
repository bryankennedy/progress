### PROG-102 — Demote Repo from a container to a focus field

**Status:** accepted (2026-07-09).

**Context.** Through v1/v2, **Repo** was a first-class container: its own `repos`
table, a nullable `actions.repoId` that narrowed an action's container to one of
its focus's repos, dedicated CRUD (`/api/repos`), routes (`/repo/:id`), board and
search filters, a Structure group, a container switcher, and MCP `repo`
parameters. In practice a focus almost always maps to one repository, the second
container level added UI weight everywhere (the awkward abstract "Container"
field on the action page, an extra board/search filter, a focus/repo-encoded
create dropdown), and — critically — **nothing load-bearing depended on it**:
GitHub PR/commit linking matches by action key and stores GitHub's `full_name`
as free text on `pr_links`/`commit_links` keyed to `actionId` only, never joined
to `repos`. The `repos.gitUrl` column was display-only.

**Decision.** Remove Repo as a container. A **focus** carries an optional
`gitUrl` (`focuses.git_url`) — the repository it mirrors — and is the **sole**
container for an action (`actions.focusId`, always set). Consequences:

- `repos` table and `actions.repoId` dropped; `focuses.gitUrl` added.
- `/api/repos` CRUD removed; focus create/patch accept `gitUrl` (validated
  `http(s)`-or-null, the same anti-XSS check the repo had, PROG-65).
- Move is now **focus → focus only** (`POST /api/actions/:id/move` takes just
  `{ focusId }`); every move re-keys and aliases. A move to the current focus is
  a no-op — there is no more within-focus repo shuffle.
- Repo is gone from the Structure page, board/search filters, both create
  dialogs, the command palette (move targets + create list), the New menu, and
  the MCP tools (`list_actions`/`create_action`/`move_action` lose `repo`).
- The action page's "Container" field becomes **"Focus"** (folding away the one
  abstract noun that leaked into the UI), showing the focus's `gitUrl` as a link.
- `/repo/:id` redirects to `/structure` so old bookmarks don't 404.
- Bundles (`renderBundle`/`renderArcBundle`) render the focus's `gitUrl` once
  instead of a per-action repo line.

**Ramifications discussed with the owner (and accepted).**

1. **Per-repo grouping within a focus is gone.** A focus that pointed at 2+ real
   repos can no longer distinguish actions by which one. This matches the v2
   "focus = area of responsibility" direction and was the explicit ask.
2. **GitHub linking is unaffected** — it never used the `repos` table, so linked
   PRs/commits keep working; `gitUrl` remains a convenience link + agent context.
3. **MCP `repo` args removed** — any automation filtering/creating by repo name
   must stop (single-user, low risk).

**Migration `0011` — the workerd/D1 wrinkle.** Backfill rule ("auto-fold"): each
focus adopts the `gitUrl` of its oldest repo that has a non-empty url, preferring
a live (non-archived) repo; conflicts (a focus with 2+ differing urls) are
flagged in the PR for manual review. Dropping `actions.repoId` requires a table
rebuild (the column carried a FK, so SQLite's `ALTER TABLE DROP COLUMN` refuses
it). The standard drizzle rebuild relies on `PRAGMA foreign_keys=OFF`, which
**D1/workerd ignores inside the migration transaction**, and `defer_foreign_keys`
doesn't clear the violation counter that `DROP TABLE actions`' implicit delete
leaves behind — so the commit is rejected. The workerd-safe pattern used here:
park every child row of `actions` (action_tags, comments, activity, pr_links,
commit_links, action_key_aliases) in temp tables, delete it, rebuild `actions`
with the self-FK pointing at the *new* table (so copied step rows aren't children
of the old one), null the old table's parent to keep its self-delete clean, then
restore the children against the rebuilt table. Validated end-to-end on a 5k-row
seed including steps, comments, and activity — all preserved, FK check clean.

Supersedes the container half of **D17** (issue container = `product_id` +
nullable `repo_id`): `focusId` is now the whole container.
