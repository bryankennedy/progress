### PROG-115 — New actions default to `backlog`, defaulting owned by the store

**Date:** 2026-07-13

**Context.** The create-action surfaces disagreed with the platform about
where a new action starts. The DB schema and the API's fallback both said
`backlog`, but every client surface — the create dialog, the Outline capture,
and the Agenda quick-add — hardcoded `status: "todo"` (plus copy-pasted
`priority: "none", estimate: null, dueDate: null` boilerplate). Captures
therefore skipped the backlog and landed straight in To do, polluting the
"deliberately queued" column with raw intake.

**Decision.** (1) A new action starts in the **backlog** everywhere;
promotion to `todo` is a deliberate act. (2) The default lives in ONE place
per layer: `DEFAULT_ACTION_STATUS` in `src/shared/constants.ts`, referenced
by the API fallback, the store, and the dialog's initial pick (the DB
schema's literal `default("backlog")` stays — Drizzle needs a literal, and a
schema change would be a pointless migration).

**The "appropriate amount of DRY".** Rather than merging the three creation
UIs into one component — they are deliberately different surfaces (a modal
form, a roving outline bullet, a one-line dated quick-add) — the shared piece
is the **defaulting path**: `ActionCreateInput` now requires only
`title + focusId`, and `store.createAction` resolves every omitted field
(arc/parent null, status `DEFAULT_ACTION_STATUS`, priority `none`, estimate/
due null) once, before building the optimistic row and the POST body from the
same resolved values — so the temp row can never disagree with what the
server stores. Call sites keep only the fields they actually mean (the
Agenda's `dueDate`/tags, the Outline's parent/arc, the dialog's explicit
picks).

**Consequences.** The Agenda quick-add now creates `backlog` (not `todo`)
actions — still visible there, since the Agenda lists every non-closed
status. The dialog still offers the full status picker; only its initial
value changed. REFERENCE §2 (anatomy) and §5 (Agenda) updated.
