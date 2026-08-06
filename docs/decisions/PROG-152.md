### PROG-152 — OutlineView owns its surfaces in every scope

**Status:** accepted (2026-08-06).

**Context.** PROG-151's "text sits on surfaces" standard carded the outline's
focus sections — but the card was tied to `showHeader`: `FocusOutline` rendered
`rounded-lg border border-line bg-card p-3` only when it showed its header. The
all-workspaces and workspace scopes show headers, so they looked done; the
focus and arc scopes hide the header (`showHeader={false}`) and silently
dropped the surface with it, leaving the whole forest naked on the canvas —
the owner hit exactly this on scoped /outline views. Meanwhile PROG-151 had
patched the container pages' embedded outline from the outside
(`ActionListView` wrapped `OutlineView` in its own card), which papered over
the same root cause and double-carded workspace-scoped lists.

**Decision.** The card belongs to the forest, not the header. `OutlineView`
supplies its own surface in every scope: all/workspace scope keeps the
per-focus-section card, and focus/arc scope wraps the forest in one
`rounded-lg border border-line bg-card p-3` container. Callers never wrap it —
`ActionListView`'s outline mode dropped its PROG-151 wrapper (that wrapper is
superseded by this entry). One owner for the decision means /outline and the
container pages' embedded lists can't drift apart again.

**Consequences.** The scoped /outline (focus or arc), the focus/arc container
pages' outline mode, and the workspace container page all render the same
surfaces as the endorsed all-workspaces view. Table mode is untouched (its
card lives in `ActionListView`/`ActionTable`, recorded in PROG-151). Verified:
273 unit tests, the full outline e2e suite (one known-flaky setup 409 passed
on retry), and screenshots of focus-scoped /outline plus a focus container
page across themes.
