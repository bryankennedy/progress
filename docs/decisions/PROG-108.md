### PROG-108 — Done buttons on the action page

**Decision.** Two ways to finish an action from its page, both plain
`status → done` moves (same optimistic `updateAction` the status select uses):

- **Complete action** — a filled primary button in the sidebar, directly above
  the status field, in the same CTA style as the Work-on-this button so
  finishing work reads as prominently as starting it. Carries a check glyph
  from the existing 16×16 glyph family.
- **Comment & close** — next to the Comment button under the timeline, for the
  "leave a wrap-up note and finish" flow. It posts the comment first and moves
  to done **only after the server confirms the comment** — on failure the
  existing draft-preserving Retry toast (PROG-51) re-sends just the comment and
  the user closes once it lands, so a failed post never half-completes the
  flow. Styled bordered-secondary so the cluster keeps one filled primary
  (Comment), mirroring GitHub's close-with-comment weighting.

Both buttons **hide when the action is already done** rather than render
disabled — a done action has nothing to complete, and the status select still
covers reopening. The sidebar status label now names the kind of thing shown:
**"Action Status"**, or **"Step Status"** when the action has a parent
(`parentActionId`, the PROG-106 chain).
