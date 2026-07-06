### PROG-91 — the decision log splits into one file per work element

Supersedes the single-file layout of `docs/DECISIONS.md`, completing the arc
that PROG-62 and `decisions-union` each deferred with "revisit if collisions
persist" — they persisted. PROG-62 removed the shared-counter race
(issue-keyed ids) and `merge=union` auto-resolved the residual both-appended-
at-EOF conflict, but only for *local* git: GitHub's PR UI does not honor
`.gitattributes` merge drivers, so every pair of parallel PRs still showed a
conflict on the PR page and needed a local merge/rebase to clear (most
recently PROG-78 vs PROG-87). The union driver also carried a standing
hazard — it silently keep-boths *edits* to settled lines — and left a cosmetic
artifact (missing blank line at the joined seam) after nearly every merge.

**The split:** each work element's decisions live in
`docs/decisions/<KEY>.md` (letter-suffixed follow-ups like `PROG-78b` stay in
their element's file); the few non-issue entries got kebab-case slugs
(`arc-work-order.md`, `decisions-union.md`, `mobile-first-audit.md`,
`board-scroll-snap.md`). Parallel branches now write *different files*, which
git merges with no driver, no convention, and no PR-UI blind spot. *Decisions
within:* (1) **D1–D49 stay together, frozen, in `decisions/D1-D49.md`** — the
numbered era is cited as `D<n>` from dozens of code comments and docs;
one-file-per-D would be 49 files nobody appends to (the collision risk is
zero on frozen content) and a citation-rewrite hazard. (2) **`DECISIONS.md`
remains as the convention doc, not an index** — a per-entry index line would
reintroduce the exact same every-PR-appends-one-line collision the split
exists to remove; the directory listing is the index (files are named by
key). (3) **Entries moved verbatim** — the split script verified zero lines
lost by re-concatenation, so the migration is a pure move and superseded
text keeps its wording. The old single-file date headings were dropped;
chronology lives in git history. (4) **`merge=union` is retired** from
`.gitattributes` — nothing appends to a shared file anymore, and keeping the
driver on the convention doc would silently merge conflicting *edits*, the
failure mode the append-only rule existed to fence off. (5) **Every surface
that teaches the convention moved with it** — `CLAUDE.md`, `docs/README.md`,
the repo `README.md`, `.agent/memory/decisions.md`, and the context bundle's
report-back preamble (`src/worker/bundle.ts`, both the per-issue and arc
variants + tests), so handed-off agents are told to create
`docs/decisions/<KEY>.md` rather than append to the log. *Rejected:* keeping
union and living with the PR-UI conflicts (the annoyance is the issue);
a generated index file (build step for a docs nicety).
