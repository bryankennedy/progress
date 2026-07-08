### PROG-100 — A shared "closed action" visual treatment across every list

**Context.** Actions show up in several list surfaces — the board columns, the
outline, container/arc pages, the search page, the agenda. Only the outline
(PROG-77) visually signalled a completed action; on the arc/container pages and
the search table a done or canceled action looked identical to an open one
except for a status word buried in a column or dropdown. The owner asked for a
common, at-a-glance "this is finished" indicator across all lists, with a
**canceled** action reading the same as a **done** one.

**Decision.** Adopt the outline's existing done styling — title **dimmed +
struck through** (`text-ink-faint line-through`) — as the one app-wide treatment
for a *closed* action (either terminal status, per `CLOSED_ACTION_STATUSES`),
and lift it into a shared helper `src/client/actionDone.ts`
(`closedTitleClass(status)` / `CLOSED_TITLE_CLASS`). Applied it to the search
table (`pages/Search.tsx`) and the container/arc action list
(`pages/ContainerPage.tsx`), and refactored the outline
(`pages/Outline.tsx`) — the styling's origin — to consume the same constant so
there is a single source of truth. Text stays fully legible (only the color
dims and a line crosses it), so a completed action can still be read.

**Why strikethrough + dim, not a checkmark.** The requirement is that canceled
and done look *identical*. A check glyph reads as "succeeded" and would be wrong
on a canceled (abandoned) action; strikethrough + dim reads as "closed / out of
play" and is honest for both. It's also already the app's own idiom (PROG-77,
and the archive/structure pages use the same `line-through` for archived rows),
so extending it keeps the UI stylistically coherent rather than introducing a
new visual language.

**Why a class helper, not a shared row/table component.** The DRY ask was real,
but the genuine duplication was the *styling*, not the row markup. The surfaces
render the title inside structurally different elements — a sortable `<table>`
with highlighted-segment spans (search), a `<ul>` with inline status/priority
`<select>`s (container pages), and an editable `<input>` (outline). A single
className composes cleanly with all three; a single component would compose with
none and would have to grow a conditional for every surface's columns and
interactions — more code and less readable, not less. So the shared unit is the
class helper; a full table-component merge was deliberately *not* done ("be DRY
where appropriate").

**Scope — surfaces deliberately left alone.**
- **Board (`pages/Home.tsx`)** — status *is* the column grouping (the "Done"
  column header is the indicator) and canceled actions never appear on the
  board at all (PROG-63), so per-card strikethrough would be redundant noise.
- **Agenda (`pages/Agenda.tsx`)** — only *pending* dated actions are listed;
  done/canceled are filtered out before render, so there is nothing to mark.

Both already communicate completion structurally; the treatment targets the
lists where a closed action otherwise looked open.
