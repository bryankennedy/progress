### PROG-62 — decision log keyed by issue, not a running number
First entry under the new scheme (and its own justification). The `D<n>`
counter assumed one author appending in sequence; with multiple agents working
different issues in parallel VMs, two of them independently reach for "the next
number" and produce a duplicate id plus a merge conflict on `DECISIONS.md` —
exactly the trivial-but-annoying collision that prompted this. Keying each entry
to the issue (`### <KEY> — title`) removes the shared counter, so entries from
different issues can never collide on their id; the only residual is a trailing
"both appended at EOF" git conflict, which is an unambiguous keep-both. Applied
in three places so the convention is coherent: this log's header rule, the
project `CLAUDE.md` decision-log description, and the **copy-as-prompt** bundle
(`src/worker/bundle.ts`) — a new *Avoiding merge collisions (parallel agents)*
section tells a handed-off agent to key append-only entries to its own issue
rather than a global sequence, generalized to any running-counter log.
*Rejected:* keeping the `D<n>` counter with a "rebase before appending" rule
(still races between branches, and renumbering on conflict is error-prone);
one-file-per-decision under `docs/decisions/` with a generated index (fully
conflict-free but a heavy restructure of 48 entries and every `(D33)` citation —
out of proportion to a trivial conflict, revisit if collisions persist).
Supersedes the implicit sequential-numbering convention; D1–D48 keep their
numbers (append-only, never renumber).
