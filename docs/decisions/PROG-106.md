### PROG-106 — a Step's breadcrumb continues through its parent actions

The action page's structural breadcrumb (PROG-103) walked the *container* tree
— Workspace / Focus / Arc / KEY — and stopped. A Step (PROG-124: an action with
a `parentActionId`) showed no trace of its parent anywhere on the page, so
opening one from a link or search landed you in a deliverable with no way to
see what it was part of. `ActionPage.tsx` never referenced `parentActionId` at
all.

This was a gap, not a settled exclusion: PROG-103's decision record enumerates
its interpretation choices (repo excluded, key as terminal crumb, unset arc
shortens the trail, container pages match) and the parent-Step case is absent
from the list. PROG-124 shipped Steps before PROG-103 rebuilt the trail; the
two never met. Surfaced while filing 19 mobile-audit findings as Steps under
MSPT-4 — every one of them rendered as though it were top-level.

The trail now descends containers first and then the parent chain:

    MSP Trees / MSP Trees Website / v1 - Public Launch / MSPT-4 / MSPT-11

Choices made:

- **The whole ancestor chain, not just the immediate parent.** Steps nest to
  unbounded depth (PROG-124), so naming only the parent would tell a half-truth
  at depth ≥ 2. The walk is `actionAncestors` in `src/client/store.ts`, kept
  next to `actionKeyOf` and unit-tested rather than inlined in the page.
- **Outermost first**, so the trail keeps reading root → leaf like the
  container crumbs above it.
- **Parent keys are linked and mono**, matching the terminal key and the board's
  `↳ PARENT-KEY` treatment. This required a one-line change to the shared
  `Breadcrumb`: `mono` previously applied only to the crumb *without* an href
  (the terminal one), so a linked key would have rendered in the body face.
- **Degrade, never throw.** A parent absent from the snapshot truncates the
  chain; a cycle terminates via a `seen` set. The API enforces acyclicity on
  reparent, but the client must not hang the tab on a corrupt payload — the
  snapshot is loaded once and everything renders from it (D17–D21).
- **A top-level action's trail is byte-for-byte what it was**, so PROG-103's
  shape is preserved for the common case. Verified at 375px that the longer
  trail still occupies one line (the component truncates rather than wraps).

Deliberately **not** done here, and worth their own actions:

- **Parent → Steps.** The parent's page still doesn't list its children. That
  wants a design call about vertical space against the timeline, and the mobile
  audit filed against this app argues for keeping the phone layout tight.
- **The context bundle omits the parent entirely.** `src/worker/bundle.ts` has
  no reference to `parentActionId`, so `Copy as prompt` on a Step hands an
  agent an isolated action with no idea it belongs to a larger piece of work,
  and no pointer to sibling Steps whose fixes overlap. This is the more
  consequential of the two — it silently degrades the agent handoff that
  SPEC §11 exists to make good.
