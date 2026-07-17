### PROG-117 — the create-action dialog mirrors the action-page sidebar

The dialog was a title input over one wrap-row of unlabeled selects — you had
to read the option text to know which control was which, the ordering shared
nothing with the action page, and it still carried the separate focus/arc
selects that PROG-123b had already replaced on the action page (that entry
explicitly deferred the dialog to "a follow-up under the consistency arc" —
this is it). Settled:

- **Same fields, same order, same anatomy.** The dialog renders the sidebar's
  labeled, icon-guttered fields in the sidebar's order — Status, Location,
  Due date, Priority, Estimate — via primitives extracted from ActionPage
  into `src/client/fields.tsx` (`Field`, `IconRow`, `IconSelect`,
  `FieldSelect`, and a new `IconDateInput` that owns the calendar-glyph +
  native-date-input pair both surfaces now share). The status panel's wash
  box and action buttons stay page-only — they operate an *existing* action;
  creation gets a plain labeled Status select.
- **One Location tree everywhere.** The palette's PROG-123b tree logic (rank
  order, archived exclusion, tree-aware filtering) moved to
  `src/client/locationRows.ts` (unit-tested); the palette maps its rows to
  palette items, and the dialog renders them in an **inline** filterable
  picker under the Location field — inline rather than reusing the palette
  overlay, because stacking a second z-50 surface over the dialog fights
  focus and Escape handling. Picking follows palette semantics: a focus row
  = "this focus, no arc"; an arc row sets both. The field's value renders as
  the sidebar's glyphed mini-tree.
- **Inline "+ New focus / + New arc" stay** (SPEC v2 §4 frictionless
  structure creation), now housed under the Location field; the picker and
  the two create panels are mutually exclusive — opening one closes the
  others.

Not touched: the container-creation dialog (no sidebar counterpart to mirror)
and `DEFAULT_ACTION_STATUS` (backlog) — the labeled Status field just makes
the existing default visible.
