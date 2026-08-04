# PROG-141 — Outline DRY / view-component consolidation pass

### PROG-141 — Split Outline.tsx's presentational seams into src/client/outline, share the repeated capture chrome and section-reorder writes, and record what stays deliberately duplicated

**Context.** The v5.1 arc merged Structure into the Outline (PROG-140), pushing
`Outline.tsx` past 2000 lines: an all-workspaces scope, three inline captures
(`InlineCapture`, `NewFocusCapture`, `NewWorkspaceCapture`) alongside the
pre-existing `CaptureRow`/`FocusCaptureRow`, and four drag branches. This action
is a judgment-driven refactor pass — not a rewrite — to eliminate the
duplication the merge introduced and lower the file's altitude along existing
seams, without touching the PROG-125 drag/memoization patterns.

**What was consolidated.**

1. **Three presentational seams moved into `src/client/outline/`** (behavior
   identical; all are leaf components off the drag-tick render path, so the
   memoized `FocusOutline`/`OutlineNode`/`Forest`/`ActionRow` identities are
   untouched):
   - `LevelIcon.tsx` — the bullet ladder, now imported by the row handle, the
     preview cards, and the captures from one place (previously a private
     function only Outline.tsx could reach).
   - `preview.tsx` — `SectionPreviewCard` + `forestPreviewRows`/
     `actionSubtreeRows`, and a named `PreviewRow` type replacing the inline
     `{ key; depth; icon; text; done? }` shape that was repeated five times.
   - `capture.tsx` — every capture input, plus one `CAPTURE_INPUT_CLASS`
     constant and a `CaptureGutter` so the identical input class string and w-6
     bullet-gutter chrome (repeated across `CaptureRow`, `FocusCaptureRow`,
     `InlineCapture`) live once.
2. **`applyContainerReorder` helper** — the workspace / focus / arc drag
   branches shared the same tail (`containerReorderRanks` → a write per rank
   change); folded into one helper so each branch reads as its intent.

**What was deliberately left duplicated / separate — do not re-litigate.**

- **`LevelIcon` (outline bullets) vs `glyphs.tsx` (`WorkspaceGlyph`/`FocusGlyph`/
  `ArcGlyph`).** Two icon *systems* for two jobs: the outline draws a
  Workflowy-style bullet ladder (square → diamond → ring → dot) that reads as
  "what level is this row"; the location glyphs (target, portfolio grid,
  rainbow arc) are used by the action page's Location field and the palette to
  point *at* a container. Same nouns, different visual language on purpose
  (PROG-104/123/140). Not merged.
- **Board cards (`Home.tsx`) vs outline rows.** Different surfaces by design —
  a card is a status-column tile, an outline row is an editable capture line.
  Only the shared *primitives* are unified (`StatusIndicator`,
  `PriorityIndicator`/`PriorityPicker`, `ActionTable`), and those already exist
  once and are imported everywhere (this branch's own PROG-126/132 work). Not
  merged.
- **`CaptureRow` vs `InlineCapture`.** They look alike but have different
  contracts: `CaptureRow`'s draft is parent-owned and mirrored to localStorage
  (PROG-107) and it runs the Tab/Shift+Tab nesting ladder; `InlineCapture` is
  self-contained with Escape/blur-to-cancel. Merging would force one to carry
  the other's machinery. They share `CAPTURE_INPUT_CLASS`/`CaptureGutter` and
  stop there. Not merged.
- **`renderFocusSections`** already genuinely serves both the all scope and the
  workspace scope (one `SortableContext` of focus sections); verified it is real
  reuse, not copy-paste. Left as-is.

**Perf note for the drag-verification pass.** No drag logic changed, but the
exercises that matter: workspace/focus/arc section reorder (now via
`applyContainerReorder`), cross-workspace focus re-parent at all scope, and
cross-focus action move — confirm the DragOverlay preview cards still render
(they now import from `outline/preview.tsx`) and that reorder still writes the
same rank updates.
