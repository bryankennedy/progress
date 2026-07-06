### DECISIONS-union — auto-resolve parallel decision-log appends with `merge=union`

PROG-62 keyed entries to the issue (killing the duplicate-`D<n>` race) but left
one residual it called "an unambiguous keep-both": two branches each appending
an entry at EOF still produce a textual git conflict, because both inserts
anchor to the same last line and git can't order them. With multiple agents
landing PRs in parallel this fired on nearly every merge — annoying, and exactly
the "revisit if collisions persist" trigger PROG-62 named.

Fix: a root `.gitattributes` marking `docs/DECISIONS.md merge=union`. The
built-in `union` driver resolves a conflicting hunk by keeping **both** sides
concatenated, with no markers and no manual step — automating the keep-both that
was always the right answer. Verified against a two-branch reproduction: without
it, `CONFLICT (content)`; with it, a clean merge holding both entries. Applies
wherever git's merge machinery runs locally — `merge`, `rebase`, `pull` — which
is the path parallel agents actually use to sync with `main`; if GitHub's PR UI
still flags a conflict, a local `git rebase main` resolves cleanly under the
driver.

*Relies on* the append-only discipline: union does not flag edits to existing
lines, it silently keeps both versions. The header rule now states this
explicitly (never rewrite a settled entry; supersede instead). *Rejected (again,
for now):* one-file-per-decision under `docs/decisions/` — still the cleaner
end-state if agents ever start editing old entries or the file grows too large
to load as context, but `merge=union` removes the actual pain at a fraction of
the cost (no migration of D1–D48, no rewrite of every `(D33)` citation). This
narrows, but does not supersede, PROG-62's deferral of the split.
