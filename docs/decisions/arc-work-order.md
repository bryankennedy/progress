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
