### PROG-95 — work orders open with "branch off fresh main"

Both bundle work orders (issue and arc) now make branch hygiene the FIRST
delivery instruction, and repeat it where the PR is opened. The issue preamble's
new item 1 gives the exact incantation (`git fetch origin && git checkout -b
iss/<KEY> origin/main`) and forbids basing on another feature branch unless the
issue explicitly directs it; the smart-commit "Push the PR" step now requires
`gh pr create --base main`. The arc order gets the same two changes on its
shared-branch and single-PR steps.

**Why:** the PROG-91/PROG-92 incident. PR #58 was opened against `iss/PROG-78`
and squash-merged onto it 32 seconds *after* that base had itself merged to
main — so the work landed on a spent branch and never reached main; PR #60
repeated it one level deeper against `iss/PROG-91`. Both had to be recovered by
cherry-pick (PR #62). The failure needed two ingredients: a stale feature
branch to base on, and nothing telling the agent that `main` is the only valid
base. Auto-delete-head-branches (repo setting, enabled 2026-07-07) removes the
first; this entry removes the second — and the instruction travels with the
prompt itself, so it reaches agents on any machine, not just ones with this
repo's CLAUDE.md.

*Decisions within:* (1) **Both bases stated, branch and PR** — branching off
main doesn't guarantee the PR targets main (GitHub suggests bases; `gh` flags
can override), so the rule appears at branch creation AND at `gh pr create
--base main`. (2) **"Unless explicitly directed" escape hatch** — stacked work
is legitimate when intentional; the rule targets the accidental default, not
the deliberate exception. (3) **A one-line why in the prompt** ("can land after
its base has already merged, stranding the work") — agents follow rules better
when the failure mode is named, and it costs one sentence. *Rejected:* encoding
the rule only in CLAUDE.md (doesn't travel with the prompt to other machines);
a CI check that PRs target main (GitHub can't block merged-into-branch PRs
retroactively, and the setting change already handles the common case).
