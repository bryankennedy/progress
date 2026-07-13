### PROG-109 — Outline scope picker: indented options, not optgroups

**Date:** 2026-07-13 · **Status:** decided

The Outline scope dropdown previously listed all focuses flat under a
"Focuses" optgroup and all workspaces under a "Workspaces" one, so nothing
showed which focus belonged to which workspace. PROG-109 asks for the
hierarchy to read in the picker itself.

**Decision.** Render one selectable `<option>` per workspace with its focuses
as `<option>`s directly beneath it, indented by three leading ` `
non-breaking spaces — rather than one `<optgroup>` per workspace.

**Why not optgroups per workspace:** `<optgroup>` labels are not selectable,
and the workspace itself is a valid scope — a workspace-as-label would have
needed a redundant "entire workspace" child option. Nbsp indentation keeps
both levels selectable in one flat list while still reading as a tree;
regular spaces don't work because HTML collapses them, and `<option>` padding
isn't styleable cross-browser.

**Tradeoff accepted:** the closed control shows the indent when a focus is
selected (e.g. "&nbsp;&nbsp;&nbsp;Progress"). Harmless, and standard for this
technique.

**Edge case:** an active focus whose workspace is missing from the active
list (archived workspace) would silently vanish from the picker; those fall
through to a trailing "Other focuses" optgroup so they stay reachable.

Ordering is unchanged: workspaces and focuses each sort `byRankThenName`
(PROG-87), so the nested list matches the Structure page and the outline's
own section order.
