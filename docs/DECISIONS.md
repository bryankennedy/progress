# Decision Log

The reasoning behind every settled choice: what was decided, why, and what was
rejected. Do not re-litigate settled decisions — supersede them with a new
entry that references the old one.

**Entries live as one file per work element in [`decisions/`](./decisions/).**
Since the PROG-91 split there is nothing to append here — this file only
explains the convention. Each issue's decisions go in
**`docs/decisions/<KEY>.md`** (e.g. `decisions/PROG-78.md`); rare non-issue
work gets a short kebab-case slug (e.g. `decisions/arc-work-order.md`).
Different branches therefore write different files, so parallel work can't
collide on this log — the failure mode that PROG-62 (issue-keyed ids) and
`decisions/decisions-union.md` (`merge=union`) each partially fixed, and this
split removes.

## Writing a decision

- **New work element** → create `docs/decisions/<KEY>.md`, headed
  `### <KEY> — <title>`.
- **Another decision from the same element** → append to that same file with a
  letter suffix (`### <KEY>b — <title>`). Same-file appends only ever conflict
  with your own element's parallel branches, which is the rare case where a
  human look is correct.
- **Superseding** → never edit a settled entry (in any file); write the new
  entry in *your* element's file and name what it supersedes.
- Keep the entry style: what was decided, why, what was rejected.

## Citing a decision

- `D1`–`D49` (the numbered legacy era) → [`decisions/D1-D49.md`](./decisions/D1-D49.md),
  cited as `D33` exactly as before. That file is frozen.
- Issue-keyed entries → cite the key (`PROG-62`, `PROG-78b`); the file is
  `decisions/<KEY>.md` (letter suffixes share the base key's file).
- Chronology lives in git history (`git log --follow docs/decisions/<file>`);
  the old single-file date headings were dropped in the split.
