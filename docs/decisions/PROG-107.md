### PROG-107 — outline capture drafts persist locally, not as DB rows

The Outline's roving "+ new bullet" input held its text in bare component
state, so a typed-but-not-Entered action silently vanished on: Tab/Shift+Tab
(the capture row **remounts** when it roves — the worst case, since Tab is part
of the capture flow itself), "+ action here" / "back to top level", a scope
switch, navigation, or a reload.

The action asked to weigh **submit-on-first-type** (create the DB row on the
first keystroke, then progressively save) against **local draft caching**, and
to advise on modern practice, performance, and hosting cost.

**Decision: local draft caching — extend the PROG-51 drafts layer; no DB write
until the explicit Enter.** How the options compare:

- **Modern practice splits on whether the entity exists yet.** Server autosave
  is the norm for editing content that is already an entity (Notion pages,
  Google Docs, Linear descriptions). For *unsubmitted new* content — a comment
  being composed, an issue-to-be — the norm is a local draft (localStorage/
  IndexedDB) cleared on explicit submit, which is what GitHub and Linear do.
  A capture bullet is the second kind: it isn't an action until Enter says so.
- **Submit-on-first-type has semantic costs beyond hosting.** A row created at
  the first keystroke leaks half-typed titles into the board, Agenda, search,
  and the MCP/agent surface; abandoning the thought now requires a delete (new
  Escape/cleanup semantics); and Enter-to-create — the capture loop's core
  gesture — becomes ambiguous. It also puts keystroke-driven load on the
  Worker + D1 (writes are the metered dimension) to buy nothing the draft
  doesn't already provide. D1 cost would be small in absolute terms; the junk
  rows are the real objection.
- **Local caching is free and already the house pattern.** PROG-51 built
  exactly this for comments/descriptions: localStorage mirror keyed
  `progress:draft:<kind>:<meId>:<targetId>`, debounced 400 ms, cleared only on
  a confirmed save. Capture reuses it as a third kind (`capture`), so the
  debounce requirement is met with zero network calls and the Experience
  consistency arc gets one pattern instead of two.

**Mechanics:** the draft state is lifted out of `CaptureRow` into
`FocusOutline` (one roving capture per focus → one draft, keyed by the focus
id), so it survives the input remounting as it roves and *travels with* Tab/
Shift+Tab nesting rather than being pinned to a tree position. A restored
draft surfaces in the top-level capture row. On unmount the pending debounce
write is **flushed, not dropped** — otherwise keystrokes in the last 400 ms
window would be lost to an immediate navigation, the exact loss being fixed.
`create()` clears state + mirror; the created row itself is covered by the
store's existing optimistic retry/rollback.

**Out of scope, noted for later:** the workspace-scope `FocusCaptureRow`
(new-focus name + prefix) still keeps its text in bare state, as does an
in-progress rename in `ActionRow` if the page unloads before blur commits.
Same pattern applies if either ever bites.
