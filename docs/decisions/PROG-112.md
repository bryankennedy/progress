### PROG-112 — copy-as-prompt reshaped for the Aug-2026 Claude Code harness

A fresh-eyes review of the action/arc work orders (`src/worker/bundle.ts`),
judging every line against what the current Claude Code harness already does by
default, what it does *against* the owner's wishes unless told otherwise, and
what an agent genuinely cannot discover on its own. Three shape rules came out
of it and are now stated at the top of `bundle.ts`:

1. **Omit what isn't there.** Empty collections (`## Comments (0)` … `_None._`,
   likewise Images / linked PRs / linked commits) and unset fields
   (`Estimate: unestimated`, `Priority: none`) render nothing at all — absence
   reads the same as an explicit "none" and every line costs the agent
   attention. This directly answers the action's "(0) comments" question.
2. **Don't restate harness defaults; do override harmful ones.** The old
   Analyze/Plan/Verify-history commit steps (`git status`, `git diff`,
   `git log`) restated what Claude Code does unprompted and were cut. The
   attribution ban went the other way — it was *widened* to cover the PR body,
   because the harness's own instructions add both a `Co-Authored-By` trailer
   and a "Generated with Claude Code" PR footer by default; only an explicit
   per-surface override wins. The **Verify** step now says what was genuinely
   missing (and what the owner called critical): run the repo's own checks —
   tests, typecheck, lint/format — and fix what breaks before pushing.
3. **Only render instructions the reader can act on.** A focus with no
   `gitUrl` (v2 household work) now gets a short comment-and-status
   report-back; the branch/commit/PR/decision-log machinery renders only when
   there is a repo to use it in. The arc order likewise keeps the sub-agent
   fan-out but drops the git sections when repo-less.

**Missing context added** (the gap recorded in PROG-106): a Step's bundle now
names its **ancestor chain** in Context (`**Step of:** KEY — title → …`,
outermost first; cycle-guarded, degrade-never-throw like the client's
`actionAncestors`) and a parent's bundle lists its **child Steps** with status
right after the description. Arc sections carry a per-action `**Step of:**`
line (parents resolved in one batched query) so the lead agent can group a
Step with its parent.

**Model selection** cannot ride a clipboard prompt — the model is chosen
before the prompt is pasted. It belongs to the launcher, so `progress work`
gained a `--model <name>` passthrough to `claude --model`; the bundle text
stays model-neutral.

**Kept deliberately** (the owner's core requirements, re-confirmed): branch off
fresh `main` with `--base main` PRs (PROG-95), conventional commits keyed
`type(scope): KEY subject`, the secret-scan step, the no-attribution rule,
don't-stall-at-a-local-commit, comment + status report-back, and the
parallel-agent decision-log scoping (PROG-62/PROG-91).

*Rejected:* including the activity log or timestamps (noise; comments carry the
narrative); an always-on git section for repo-less focuses (unusable
instructions train the reader to skim); naming a model in the bundle text
(couples a durable artifact to a moving model lineup); per-repo check commands
in the bundle (the repo's own CLAUDE.md/package.json is the source of truth —
the bundle just points there).
