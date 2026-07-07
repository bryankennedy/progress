### PROG-98 — Hierarchy nouns renamed: Workspace / Focus / Arc / Action / Step

The owner's hierarchy is now **Workspace → Focus → Repo/Arc → Action (→ Step)**.
This supersedes the original noun choices (D2 and the early SPEC vocabulary:
Initiative → Product → Repo/Arc → Issue) — v2 stretched "Product" over
life-areas like Household as a deliberate mental shortcut (SPEC v2 §3, D36);
this rename removes the stretch so the names fit dev and non-dev work equally.
The rename is **full-depth**: code identifiers, wire types, API routes, client
routes, UI labels, *and* storage — migration `0010_rename_hierarchy` renames the
tables/columns in place (`initiatives`→`workspaces`, `products`→`focuses`,
`issues`→`actions`, `issue_key_aliases`→`action_key_aliases`,
`issue_tags`→`action_tags`; `initiative_id`→`workspace_id`,
`product_id`→`focus_id`, `issue_id`→`action_id`,
`parent_issue_id`→`parent_action_id`, `next_issue_number`→`next_action_number`;
indexes recreated under matching new names). No data is copied and no rows are
rewritten — a half-rename where docs say one thing and `SELECT *` says another
would be worse than either name.

*Decisions within:* (1) **Plural of Focus is "focuses"** — greppable,
unambiguous, and reads like the rest of the codebase; "foci" was rejected as
precious. (2) **Step is not a new entity** — it's the PROG-124 sub-issue
structure renamed: an Action with `parentActionId` set, same row shape, same
same-focus/acyclic invariants. Dedicated Step UI comes later; this entry only
names the thing. (3) **Arc and Repo keep their names** — they already fit both
worlds. Historical docs (`docs/archive/`, `decisions/D1-D49.md`, pre-rename
decision files) keep the old nouns; they describe the past accurately and are
not edited.

### PROG-98b — The load-everything payload is now "snapshot"

"Workspace" became a container noun (the top of the hierarchy), so the old use
of the word — the `GET /api/workspace` load-everything payload — had to move
out of its way. The payload is now the **snapshot**: `GET /api/snapshot`,
`WorkspacePayload` → `SnapshotPayload`, `useWorkspace()` → `useSnapshot()` (and
the TanStack cache key `['workspace']` → `['snapshot']`). "Snapshot" also says
what it is more honestly than "workspace" ever did: one point-in-time picture
of everything, fetched once with `staleTime: Infinity` (D21). Reusing
"workspace" for both the container and the payload was rejected outright — a
noun meaning "one row" and "all rows" simultaneously is the exact vocabulary
failure this product exists to avoid.

### PROG-98c — Compatibility: legacy routes alias, ids and keys immutable

The rename ships with a compatibility layer so nothing external breaks:

- **Legacy API paths alias.** The Worker serves the exact path
  `/api/workspace` as `/api/snapshot` and rewrites the prefixes
  `/api/initiatives`→`/api/workspaces`, `/api/products`→`/api/focuses`,
  `/api/issues`→`/api/actions` before routing — old scripts, MCP builds, and
  bookmarked URLs keep working.
- **Legacy client routes redirect.** `/issue/:key`, `/initiative/:id`, and
  `/product/:id` redirect to `/action/:key`, `/workspace/:id`, `/focus/:id`;
  the board's `?subissues` param became `?steps`.
- **Action keys are untouched.** `PROG-98` is still `PROG-98`:
  keyPrefix/number derivation and the alias table's contents didn't change,
  only the table's name did. Keys are the public identity; renaming them was
  never on the table.
- **Row ids are immutable.** Existing rows keep their `ini_`/`prd_`/`iss_`
  prefixes; new rows mint `wsp_`/`foc_`/`acn_` (`acn_` because `act_` was
  already taken by activity rows). Ids are opaque and never parsed (D19), so
  the two generations coexist indefinitely — rewriting PKs across every FK for
  a cosmetic prefix was rejected as pure risk with no functional payoff.
- **Agent branches are `act/<KEY>`** (was `iss/<KEY>`) in the bundle work order
  and `progress work` CLI. The GitHub webhook links by key mention, agnostic of
  branch prefix, so existing `iss/` branches keep linking.
