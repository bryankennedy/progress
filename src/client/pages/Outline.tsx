// Outline capture view (PROG-124, docs/intent/outline-capture.md): a
// Workflowy-style outliner for fast keyboard capture of actions as nested
// bullets. One Action data type — a step is just an action with a
// `parentActionId`. The root picker scopes to a Workspace or a Focus and
// sets the ceiling (Focus root → Arc/Action/Step; Workspace root →
// Focus/Arc/Action/Step). A fresh bullet is always an Action; Arc/Focus
// are reached only by the explicit "→ Arc" / structure controls, never typed.
//
// Capture loop: type in the trailing "+ new bullet" → Enter creates an action
// and keeps focus for the next sibling; Tab on that bullet deepens it under the
// last sibling (→ step), Shift+Tab pops back up. Existing rows rename on
// Enter/blur and reparent in place via Tab/Shift+Tab. Nothing here deletes or
// archives — each row's bullet is its handle (PROG-111): tap/click opens the
// full action/arc/focus page, press-and-drag reorders — and, dropped outside
// its own sibling group, MOVES the action into another arc or focus (PROG-118).

import {
  createContext,
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { WireArc, WireAction, WireFocus } from "../../shared/types";
import type { SnapshotPayload } from "../../shared/types";
import { isOpenStatus } from "../../shared/constants";
import { CLOSED_TITLE_CLASS } from "../actionDone";
import {
  createContainer,
  createAction,
  actionKeyOf,
  moveAction,
  updateContainer,
  updateAction,
} from "../store";
import { clearDraft, readDraft, writeDraft } from "../drafts";
import PriorityPicker from "../PriorityPicker";
import StatusIndicator from "../StatusIndicator";
import { DROP_ANIMATION } from "../dropAnimation";
import { rankForInsert, rankForReorder, type ReorderPlacement } from "../outlineReorder";
import { byRankThenName, containerReorderRanks } from "../containerReorder";
import { loadHideDone, loadScope, saveHideDone, saveScope } from "../outlinePrefs";
// Tree model + sibling rules live in outlineTree.ts (pure, unit-tested).
import {
  buildForest,
  byRankThenNumber,
  inSubtreeOf,
  siblingsOf,
  type OutlineNode as Node,
} from "../outlineTree";

// ---------- level icons ----------

function LevelIcon({ kind }: { kind: "workspace" | "focus" | "arc" | "action" | "sub" }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  // Workspace sits one level above the focus square (PROG-140): an outlined
  // square enclosing a filled one, reading as "a container that holds focuses".
  if (kind === "workspace")
    return (
      <svg viewBox="0 0 16 16" className={`${cls} text-adobe-deep`} aria-hidden>
        <rect
          x="1.5"
          y="1.5"
          width="13"
          height="13"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <rect x="5" y="5" width="6" height="6" rx="1.5" fill="currentColor" />
      </svg>
    );
  if (kind === "focus")
    return (
      <svg viewBox="0 0 16 16" className={`${cls} text-adobe-deep`} fill="currentColor" aria-hidden>
        <rect x="2" y="2" width="12" height="12" rx="2.5" />
      </svg>
    );
  if (kind === "arc")
    return (
      <svg
        viewBox="0 0 16 16"
        className={`${cls} text-moss`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden
      >
        <path d="M8 2.5 14 6 8 9.5 2 6 8 2.5Z" />
        <path d="M2 10l6 3.5L14 10" />
      </svg>
    );
  if (kind === "action")
    return (
      <svg
        viewBox="0 0 16 16"
        className={`${cls} text-ink-faint`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden
      >
        <circle cx="8" cy="8" r="4.5" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" className={`${cls} text-ink-faint`} fill="currentColor" aria-hidden>
      <circle cx="8" cy="8" r="2.5" />
    </svg>
  );
}

// ---------- the consolidated row handle (PROG-111) ----------

// Swallow the browser's synthesized post-drag click (PROG-130). After a touch
// drag, iOS Safari fires a simulated `click` at the RELEASE point — and by
// then the drop has re-sorted the rows, so that click lands on some OTHER
// row's handle. dnd-kit guards clicks with a document-capture stopPropagation
// (so no React handler — including Handle's own moved-distance guard — ever
// runs), but stopPropagation doesn't cancel a click's DEFAULT action, and the
// handle is a real <a href>: the browser navigated natively to whatever row
// slid under the finger. A window-capture listener runs before dnd-kit's
// document one, so this can preventDefault the ghost click first. One-shot,
// disarmed after the first click or 400ms, whichever comes first.
function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    disarm();
  };
  const disarm = () => window.removeEventListener("click", swallow, true);
  window.addEventListener("click", swallow, true);
  setTimeout(disarm, 400);
}

// ONE handle per row/section header, replacing the old three-icon gutter (the
// 6-dot drag grip + the far-left ⋯ open-link + a separate level bullet). The
// glyph IS the level bullet — focus square, arc layers, action ring, step dot —
// so the handle itself says what the row is, and it answers both gestures:
// click/tap opens the item's page; press-and-drag starts the sortable move
// (PointerSensor's 4px activation distance keeps a plain tap from becoming a
// phantom drag). Rendered as a real <a> so middle/cmd-click open-in-tab
// survives; navigation is suppressed when the pointer actually travelled —
// i.e. the trailing "click" was a drag's release, not a tap. touch-none so a
// touch drag reorders instead of scrolling; draggable={false} +
// touch-callout none so the anchor's native drag/press behaviors can't hijack
// the sortable.
function Handle({
  kind,
  href,
  label,
  handleRef,
  handleProps,
}: {
  kind: "workspace" | "focus" | "arc" | "action" | "sub";
  href: string;
  label: string;
  handleRef: (el: HTMLElement | null) => void;
  handleProps: HTMLAttributes<HTMLElement>;
}) {
  const [, navigate] = useLocation();
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const { onPointerDown: dndPointerDown, onKeyDown: dndKeyDown, ...restHandleProps } = handleProps;
  return (
    <a
      ref={handleRef}
      {...restHandleProps}
      href={href}
      draggable={false}
      aria-label={label}
      title="Open — drag to move"
      onPointerDown={(e) => {
        downAt.current = { x: e.clientX, y: e.clientY };
        dndPointerDown?.(e);
      }}
      onKeyDown={(e) => {
        // Space hands off to the keyboard sensor (pick up, arrow-reorder);
        // Enter falls through to native link activation → navigate. While a
        // keyboard drag is live the sensor preventDefaults its own keys, so
        // dropping with Enter doesn't also navigate.
        if (e.key === " ") dndKeyDown?.(e);
      }}
      onClick={(e) => {
        const d = downAt.current;
        downAt.current = null;
        // A pointer click we never saw the pointerdown for is a post-drag
        // ghost that landed here after the rows re-sorted (PROG-130) — never
        // a navigation intent. Keyboard activation (Enter) has detail 0 and
        // no pointerdown; it falls through to navigate.
        if (!d && e.detail > 0) {
          e.preventDefault();
          return;
        }
        const moved = d ? Math.hypot(e.clientX - d.x, e.clientY - d.y) : 0;
        if (moved > 4) {
          e.preventDefault(); // this "click" was the tail of a drag
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return; // browser default (new tab &c.)
        e.preventDefault();
        navigate(href);
      }}
      className="flex h-6 w-6 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded [-webkit-touch-callout:none] hover:bg-line active:cursor-grabbing"
    >
      <LevelIcon kind={kind} />
    </a>
  );
}

// A container section (an arc's block, or a whole focus at workspace scope)
// as a sortable unit (PROG-87): the section moves as one block, and only the
// handle handed to `children` starts a drag, so the header's link and
// everything inside keep working normally. The handle doubles as the header's
// level bullet + open-link (PROG-111), hence kind/href.
function SortableSection({
  id,
  kind,
  href,
  label,
  className,
  children,
}: {
  id: string;
  kind: "workspace" | "focus" | "arc";
  href: string;
  label: string;
  className?: string;
  children: (grip: ReactNode) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  // The grabbed section is carried by a DragOverlay (the board's pattern), so
  // the in-list source stays put and dims to a ghost; only its NEIGHBOURS get
  // the sorting translate, sliding aside to show the drop slot.
  const style: CSSProperties | undefined = isDragging
    ? undefined
    : { transform: CSS.Translate.toString(transform), transition };
  // A stable grip element (PROG-125): useSortable re-renders this component on
  // every drag tick (it subscribes to dnd-kit's contexts), and `children(grip)`
  // re-runs each time. dnd-kit's attributes/listeners are identity-stable, so
  // memoizing the grip keeps the element — and thus everything a memoized child
  // derives from it — unchanged across those ticks.
  const grip = useMemo(
    () => (
      <Handle
        kind={kind}
        href={href}
        label={label}
        handleRef={setActivatorNodeRef}
        handleProps={{ ...attributes, ...listeners }}
      />
    ),
    [kind, href, label, setActivatorNodeRef, attributes, listeners],
  );
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        [className, isDragging ? "opacity-30" : undefined].filter(Boolean).join(" ") || undefined
      }
    >
      {children(grip)}
    </div>
  );
}

// ---------- drag-overlay previews (PROG-87 polish) ----------

// What the DragOverlay carries while a container section is dragged: a floating
// card that reads as "the whole grouping", capped to a handful of rows so a
// long section doesn't become a screen-tall cursor. Static text only — nothing
// in the overlay is interactive.
const PREVIEW_ROWS = 6;

function SectionPreviewCard({
  header,
  rows,
  more,
}: {
  header: ReactNode;
  rows: { key: string; depth: number; icon: ReactNode; text: string; done?: boolean }[];
  more: number;
}) {
  return (
    <div
      data-drag-overlay
      className="cursor-grabbing rounded-lg border border-line bg-card p-2 shadow-xl ring-1 ring-black/5"
    >
      <div className="flex items-center gap-1.5">{header}</div>
      {rows.slice(0, PREVIEW_ROWS).map((r) => (
        <div
          key={r.key}
          className="flex items-center gap-1.5 py-0.5"
          style={{ paddingLeft: 8 + r.depth * 22 }}
        >
          {r.icon}
          <span className={`truncate text-sm ${r.done ? CLOSED_TITLE_CLASS : "text-ink"}`}>
            {r.text}
          </span>
        </div>
      ))}
      {more > 0 && <div className="py-0.5 pl-2 text-xs text-ink-faint">… {more} more</div>}
    </div>
  );
}

// Flatten a forest into preview rows (depth-first, matching rendered order).
function forestPreviewRows(
  forest: Node[],
): { key: string; depth: number; icon: ReactNode; text: string; done?: boolean }[] {
  const rows: { key: string; depth: number; icon: ReactNode; text: string; done?: boolean }[] = [];
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      rows.push({
        key: n.action.id,
        depth: n.depth,
        icon: <LevelIcon kind={n.depth === 0 ? "action" : "sub"} />,
        text: n.action.title,
        done: !isOpenStatus(n.action.status),
      });
      walk(n.children);
    }
  };
  walk(forest);
  return rows;
}

// A held action row's overlay rows: its visible step subtree (depth-first,
// rank order), so dragging a parent reads as carrying its block — matching
// what a same-focus drop actually moves (PROG-118).
function actionSubtreeRows(
  actions: WireAction[],
  rootId: string,
): { key: string; depth: number; icon: ReactNode; text: string; done?: boolean }[] {
  const byParent = new Map<string, WireAction[]>();
  for (const a of actions) {
    if (a.parentActionId === null) continue;
    const sibs = byParent.get(a.parentActionId);
    if (sibs) sibs.push(a);
    else byParent.set(a.parentActionId, [a]);
  }
  const rows: { key: string; depth: number; icon: ReactNode; text: string; done?: boolean }[] = [];
  const walk = (id: string, depth: number) => {
    for (const c of (byParent.get(id) ?? []).sort(byRankThenNumber)) {
      rows.push({
        key: c.id,
        depth,
        icon: <LevelIcon kind="sub" />,
        text: c.title,
        done: !isOpenStatus(c.status),
      });
      walk(c.id, depth + 1);
    }
  };
  walk(rootId, 0);
  return rows;
}

// ---------- arc promotion control ----------

function ArcMenu({ action, arcs }: { action: WireAction; arcs: WireArc[] }) {
  const [open, setOpen] = useState(false);
  const focusArcs = arcs.filter((a) => a.focusId === action.focusId && !a.archivedAt);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Assign to an arc"
        className="rounded px-1 text-xs text-ink-faint hover:bg-line hover:text-ink-soft"
      >
        {action.arcId ? "arc ▾" : "→ arc"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-1 w-48 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-xl">
            {focusArcs.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setOpen(false);
                  void updateAction(action.id, { arcId: a.id });
                }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-line ${action.arcId === a.id ? "text-adobe-deep" : "text-ink-soft"}`}
              >
                {a.name}
              </button>
            ))}
            <button
              onClick={() => {
                setOpen(false);
                const name = window.prompt("New arc name");
                if (name && name.trim()) {
                  const id = createContainer({
                    kind: "arc",
                    name: name.trim(),
                    focusId: action.focusId,
                  });
                  void updateAction(action.id, { arcId: id });
                }
              }}
              className="block w-full border-t border-line px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-line"
            >
              + New arc…
            </button>
            {action.arcId && (
              <button
                onClick={() => {
                  setOpen(false);
                  void updateAction(action.id, { arcId: null });
                }}
                className="block w-full border-t border-line px-3 py-1.5 text-left text-sm text-ink-faint hover:bg-line"
              >
                Remove from arc
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- render-isolation contexts (PROG-125) ----------

// The outline renders every row in scope as a dnd-kit sortable, and dnd-kit
// re-renders EVERY sortable on each drag tick (each row the pointer crosses,
// each droppable re-measure — its contexts carry `over`/rect maps). With ~100+
// rows, re-rendering each row's full subtree (input, indicators, arc menu) on
// every tick froze pickup for over a second and stalled mid-drag. The fix is
// render isolation: rows are memoized, and everything they need beyond their
// own node travels through these two contexts with drag-stable identities, so
// a tick re-runs only the cheap sortable wrappers.

// Per-focus row environment: stable for the whole life of a snapshot.
type RowEnv = {
  ws: SnapshotPayload;
  arcs: WireArc[];
  onIndent: (action: WireAction) => void;
  onOutdent: (action: WireAction) => void;
};
const RowEnvContext = createContext<RowEnv | null>(null);

// The roving capture state. Only the slot whose node matches `parentId`
// renders anything, so a keystroke in the capture input re-renders N trivial
// null-returning slots instead of every row subtree (the pre-PROG-125 shape
// passed a fresh renderCapture closure to every row on every keystroke).
type CaptureEnv = {
  parentId: string | null;
  draft: string;
  focusToken: number;
  onDraftChange: (next: string) => void;
  onCreateUnder: (title: string, parent: WireAction) => void;
  onDeepen: () => void;
  onShallow: () => void;
};
const CaptureContext = createContext<CaptureEnv | null>(null);

function CaptureSlot({ node }: { node: Node }) {
  const cap = useContext(CaptureContext);
  if (!cap || cap.parentId !== node.action.id) return null;
  return (
    <CaptureRow
      depth={node.depth + 1}
      placeholder="New step — Enter to add, Shift+Tab to outdent"
      draft={cap.draft}
      onDraftChange={cap.onDraftChange}
      onCreate={(t) => cap.onCreateUnder(t, node.action)}
      onDeepen={cap.onDeepen}
      onShallow={cap.onShallow}
      focusToken={cap.focusToken}
    />
  );
}

// ---------- a single editable action row ----------

// Memoized (PROG-125): dnd-kit context ticks re-render the enclosing
// OutlineNode on every drag step; this memo stops the row's real content from
// re-rendering with it. dnd-kit's `listeners`/`attributes` are identity-stable
// (attributes changes only for the held row), so the props only change when
// the row's data actually does.
const ActionRow = memo(function ActionRow({
  node,
  handleRef,
  handleAttributes,
  handleListeners,
}: {
  node: Node;
  // Drag-to-reorder wiring from the enclosing sortable (PROG-86). Lives on the
  // row's single bullet handle, not the whole row, so the title input stays
  // fully editable. Attributes/listeners ride as separate props (not a merged
  // object) so their stable identities keep the memo effective.
  handleRef: (el: HTMLElement | null) => void;
  handleAttributes: HTMLAttributes<HTMLElement>;
  handleListeners: HTMLAttributes<HTMLElement> | undefined;
}) {
  const { ws, arcs, onIndent, onOutdent } = useContext(RowEnvContext)!;
  const { action, depth } = node;
  // Completed (done/canceled) actions stay visible but read as "finished": lower
  // contrast + strikethrough (PROG-77). The whole-page "hide done" toggle drops
  // them from the forest entirely; this styling is only reached when they show.
  const done = !isOpenStatus(action.status);
  const [draft, setDraft] = useState(action.title);
  const inputRef = useRef<HTMLInputElement>(null);
  // Keep the input in sync if the title changes elsewhere (e.g. server
  // reconcile) — but never clobber an edit in progress; a focused input owns
  // its draft until commit.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(action.title);
  }, [action.title]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== action.title) void updateAction(action.id, { title: next });
    else if (!next) setDraft(action.title); // never blank a saved action
  };

  const actionKey = actionKeyOf(ws, action);

  return (
    <div
      className="group flex items-center gap-1.5 rounded py-0.5 hover:bg-line/30"
      style={{ paddingLeft: depth * 22 }}
    >
      {/* The row's single handle (PROG-111): the level bullet, tappable to open
          the action page (no hover needed — touch-friendly, PROG-80) and
          draggable to reorder (PROG-86). */}
      <Handle
        kind={depth === 0 ? "action" : "sub"}
        href={`/action/${actionKey}`}
        label={`Open ${actionKey} — drag to reorder`}
        handleRef={handleRef}
        handleProps={{ ...handleAttributes, ...handleListeners }}
      />
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            // blur() fires onBlur synchronously — commit happens there, once.
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            commit();
            onIndent(action);
          } else if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            commit();
            onOutdent(action);
          }
        }}
        className={`min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm focus:bg-card focus:outline-none focus:ring-1 focus:ring-line ${
          done ? CLOSED_TITLE_CLASS : "text-ink"
        }`}
      />
      {/* Arc assignment stays a hover/focus affordance — desktop-only polish,
          not a navigation control. */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        {depth === 0 && <ArcMenu action={action} arcs={arcs} />}
      </div>
      {/* At-a-glance state, right-aligned (PROG-124): the shared priority +
          status glyphs every other view uses. Status is on every row, so it
          holds the outermost column and the right edge stays flush; priority
          sits just inside it. The glyph is the shared editable PriorityPicker
          (PROG-136) — same in-place control as the table cell and Agenda
          rows. "None" still reads as nothing at a glance (PROG-124): its
          hollow ring only fades in on row hover / focus, but the picker stays
          hit-testable even while transparent, so a tap where the glyph sits
          works on touch too. */}
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          className={
            action.priority === "none"
              ? "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
              : ""
          }
        >
          <PriorityPicker actionId={action.id} priority={action.priority} />
        </span>
        <StatusIndicator status={action.status} />
      </span>
    </div>
  );
});

// ---------- sortable subtree block ----------

// One node of the forest as a sortable item (PROG-86). The whole SUBTREE (row +
// its descendants + the roving capture slot) is the sortable element, so
// dragging a parent visually carries its children as a block. The activator is
// the bullet handle inside ActionRow, so only it starts a drag — the title
// input keeps working normally. A drop within the sibling group reorders; a
// drop outside it moves the action there (see the page's onDragEnd, PROG-118).
// No FLIP layout animation on rows (PROG-125): dnd-kit's default re-measures
// every row in a group (a getBoundingClientRect each, in per-row layout
// effects) whenever a group's membership changes mid-drag — i.e. on every
// cross-group preview hop, the outline's signature move. The within-group
// slide is transform-based (verticalListSortingStrategy) and keeps animating;
// what's lost is only the brief glide of rows BELOW a cross-group insertion
// point, which now snap to their new spot — a fair trade at hundreds of rows.
const noLayoutAnimation = () => false;

const OutlineNode = memo(function OutlineNode({ node }: { node: Node }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: node.action.id, animateLayoutChanges: noLayoutAnimation });
  // The grabbed subtree is carried by the page's DragOverlay (the board-card
  // pattern, PROG-118 polish): the in-list source dims to a ghost but KEEPS
  // its sorting translate (exactly like BoardCard), so it slides in step with
  // its neighbours and marks the slot the drop would take.
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-30" : undefined}>
      <ActionRow
        node={node}
        handleRef={setActivatorNodeRef}
        handleAttributes={attributes}
        handleListeners={listeners}
      />
      <Forest nodes={node.children} />
      <CaptureSlot node={node} />
    </div>
  );
});

// A sibling group as a SortableContext so its rows reorder within it (PROG-86);
// recurses through each node's children (their own group/context). Memoized,
// with a memoized `items` array: SortableContext treats a fresh items identity
// as "the list changed" and queues a re-measure of every droppable in the
// group, so identity stability here is load-bearing for drag performance
// (PROG-125), not just a render micro-optimization.
const Forest = memo(function Forest({ nodes }: { nodes: Node[] }) {
  const items = useMemo(() => nodes.map((n) => n.action.id), [nodes]);
  if (nodes.length === 0) return null;
  return (
    <SortableContext items={items} strategy={verticalListSortingStrategy}>
      {nodes.map((node) => (
        <OutlineNode key={node.action.id} node={node} />
      ))}
    </SortableContext>
  );
});

// ---------- focus capture (workspace scope only) ----------

// A workspace's first action needs a focus to live on, and a focus needs a
// permanent, unique action-key prefix (e.g. PROG). So unlike actions/arcs, a
// focus can't be a bare "type a name" bullet — but we keep the Workflowy feel:
// type the name → the prefix auto-fills (editable) → Enter. The prefix is
// deduped against every existing focus client-side so Enter never hits a 409.
const suggestPrefix = (name: string) =>
  name
    .toUpperCase()
    .replaceAll(/[^A-Z]/g, "")
    .slice(0, 4);

function FocusCaptureRow({
  workspaceId,
  existingPrefixes,
  focusToken,
  onCreated,
  onCancel,
}: {
  workspaceId: string;
  existingPrefixes: Set<string>;
  focusToken: number;
  onCreated: () => void;
  // Present when the row is a collapsible capture (all scope, PROG-140): Escape
  // collapses it back to the "+ new focus" button. The always-visible
  // workspace-scope row omits it and never collapses.
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [prefixTouched, setPrefixTouched] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // Refocus the name field after each create so focuses capture continuously.
  useEffect(() => {
    if (focusToken > 0) nameRef.current?.focus();
  }, [focusToken]);

  const norm = prefix.toUpperCase();
  const prefixValid = /^[A-Z]{2,8}$/.test(norm);
  const clash = prefixValid && existingPrefixes.has(norm);
  const canSubmit = name.trim() !== "" && prefixValid && !clash;

  const submit = () => {
    if (!canSubmit) return;
    createContainer({ kind: "focus", name: name.trim(), workspaceId, keyPrefix: norm });
    setName("");
    setPrefix("");
    setPrefixTouched(false);
    onCreated();
  };

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      {/* Match the rows' w-6 handle gutter so bullets align (PROG-111). */}
      <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden>
        <LevelIcon kind="focus" />
      </span>
      <input
        ref={nameRef}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!prefixTouched) setPrefix(suggestPrefix(e.target.value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="New focus — Enter to add"
        className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm text-ink placeholder:text-ink-faint focus:bg-card focus:outline-none focus:ring-1 focus:ring-line"
      />
      <input
        value={prefix}
        onChange={(e) => {
          setPrefixTouched(true);
          setPrefix(
            e.target.value
              .toUpperCase()
              .replaceAll(/[^A-Z]/g, "")
              .slice(0, 8),
          );
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="KEY"
        title="Action-key prefix: 2–8 letters, unique across focuses"
        className={`w-16 shrink-0 rounded bg-transparent px-1 py-0.5 text-center font-mono text-[11px] uppercase focus:bg-card focus:outline-none focus:ring-1 ${
          clash ? "text-adobe-deep ring-1 ring-adobe" : "text-ink-faint focus:ring-line"
        }`}
      />
      {clash && <span className="shrink-0 text-[11px] text-adobe-deep">in use</span>}
    </div>
  );
}

// ---------- inline structure capture (PROG-140) ----------

// A one-field name capture for containers whose only required datum is a name —
// arcs and workspaces (a focus additionally needs its key prefix, so it keeps
// its own FocusCaptureRow). Enter creates and stays open for the next sibling
// (the Workflowy capture loop); Escape or blur collapses. The icon renders in
// the same w-6 gutter as the rows' bullet handle so the input lines up.
function InlineCapture({
  icon,
  placeholder,
  depth = 0,
  onSubmit,
  onCancel,
}: {
  icon: ReactNode;
  placeholder: string;
  depth?: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: depth * 22 }}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden>
        {icon}
      </span>
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const t = name.trim();
            if (t) {
              onSubmit(t);
              setName(""); // stay open for the next sibling
            }
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={onCancel}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm text-ink placeholder:text-ink-faint focus:bg-card focus:outline-none focus:ring-1 focus:ring-line"
      />
    </div>
  );
}

// A "+ new focus" affordance for a workspace section at all scope (PROG-140):
// collapsed to a text button, expands to the shared FocusCaptureRow. Local
// open/token state keeps each workspace's capture independent.
function NewFocusCapture({
  workspaceId,
  existingPrefixes,
}: {
  workspaceId: string;
  existingPrefixes: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(0);
  if (!open)
    return (
      <button
        onClick={() => {
          setOpen(true);
          setToken((t) => t + 1);
        }}
        className="ml-[30px] rounded px-1 py-0.5 text-xs text-ink-faint hover:bg-line hover:text-ink-soft"
      >
        + new focus
      </button>
    );
  return (
    <FocusCaptureRow
      workspaceId={workspaceId}
      existingPrefixes={existingPrefixes}
      focusToken={token}
      onCreated={() => setToken((t) => t + 1)}
      onCancel={() => setOpen(false)}
    />
  );
}

// A "+ new workspace" affordance at the foot of the all scope (PROG-140):
// collapsed to a text button, expands to a bare name input (a workspace needs
// no key prefix). Creating stays open for the next one; Escape/blur collapses.
function NewWorkspaceCapture() {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded px-1 py-0.5 text-sm text-ink-faint hover:bg-line hover:text-ink-soft"
      >
        + new workspace
      </button>
    );
  return (
    <InlineCapture
      icon={<LevelIcon kind="workspace" />}
      placeholder="New workspace — Enter to add"
      onSubmit={(name) => createContainer({ kind: "workspace", name })}
      onCancel={() => setOpen(false)}
    />
  );
}

// ---------- the capture (roving new-bullet) input ----------

// The draft is OWNED BY THE PARENT (PROG-107), not local state: this component
// unmounts and remounts every time capture roves (Tab/Shift+Tab, "+ action
// here", "back to top level"), and local state would silently drop whatever was
// typed. The parent also mirrors the draft to localStorage, so it survives
// navigation and reloads too.
function CaptureRow({
  depth,
  placeholder,
  draft,
  onDraftChange,
  onCreate,
  onDeepen,
  onShallow,
  focusToken,
}: {
  depth: number;
  placeholder: string;
  draft: string;
  onDraftChange: (next: string) => void;
  onCreate: (title: string) => void;
  onDeepen: () => void;
  onShallow: () => void;
  focusToken: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Refocus after each create (focusToken bumps) so capture stays continuous.
  useEffect(() => {
    if (focusToken > 0) ref.current?.focus();
  }, [focusToken]);

  return (
    <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: depth * 22 }}>
      {/* The ＋ sits in the same w-6 gutter as the rows' bullet handle so it
          lines up with the action bullets above it (PROG-111). */}
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-faint/50"
        aria-hidden
      >
        ＋
      </span>
      <input
        ref={ref}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const t = draft.trim();
            if (t) onCreate(t); // the parent clears the draft on create
          } else if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            onDeepen();
          } else if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            onShallow();
          }
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm text-ink placeholder:text-ink-faint focus:bg-card focus:outline-none focus:ring-1 focus:ring-line"
      />
    </div>
  );
}

// ---------- one focus's outline (forest + capture) ----------

// Memoized (PROG-125): at workspace scope every drag tick re-renders the
// enclosing SortableSection, and a preview hop re-slices only the affected
// focuses — so with stable props (the page's per-focus identity cache + the
// section's memoized grip) untouched focuses skip re-rendering entirely.
const FocusOutline = memo(function FocusOutline({
  focus,
  ws,
  focusActions,
  showHeader,
  grip,
  arcOnly,
}: {
  focus: WireFocus;
  ws: SnapshotPayload;
  // What the forest renders: THIS focus's slice of the hide-done-filtered (and
  // preview-patched) action list, computed at page level since the page's drag
  // handlers slot drops into the same rendered groups (PROG-118). Identity is
  // cached per focus (PROG-125) so a drag preview only re-renders the focuses
  // it touches. Capture/indent helpers keep working off the full `ws.actions`
  // list so nesting math is unaffected by what's visible.
  focusActions: WireAction[];
  showHeader: boolean;
  // At workspace scope the whole section is sortable (PROG-87); the enclosing
  // SortableSection hands its drag grip down to render in the header.
  grip?: ReactNode;
  // Arc-page embed (PROG-126): render ONLY this arc's forest — no loose level,
  // no arc section chrome, top level at depth 0 — with capture pinned inside
  // the arc. Everything else (drag, indent, roving capture below the top
  // level) behaves exactly like the arc's section on the outline page.
  arcOnly?: WireArc;
}) {
  const actions = ws.actions;
  const arcs = ws.arcs;
  // The roving capture target: which action the next new bullet nests under
  // (null = focus top level, no arc). `captureArc` scopes a top-level new
  // bullet to an arc section. Re-validated against live data each render.
  const [captureParent, setCaptureParent] = useState<string | null>(null);
  const [captureArc, setCaptureArc] = useState<string | null>(arcOnly ? arcOnly.id : null);
  const [focusToken, setFocusToken] = useState(0);
  // Inline "+ new arc" capture at the focus's foot (PROG-140), a structure
  // control parallel to the action-capture rows — kept out of the roving
  // capture state since arcs aren't part of the action nesting ladder.
  const [addingArc, setAddingArc] = useState(false);

  // The unsent capture text (PROG-107). Lifted out of CaptureRow so it survives
  // the input remounting as capture roves, and mirrored to localStorage
  // (debounced — the PROG-51 drafts pattern, same 400ms as comment drafts) so
  // typed-but-not-Entered text also survives scope switches, navigation, and
  // reloads. Cleared only once the action is actually created.
  const meId = ws.me?.id ?? "anon";
  // Arc-page embeds draft under the arc id, so an arc capture and the outline
  // page's focus capture never clobber each other's saved text.
  const draftId = arcOnly ? arcOnly.id : focus.id;
  const [captureDraft, setCaptureDraft] = useState(() => readDraft("capture", meId, draftId));
  const captureDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const captureDraftRef = useRef(captureDraft);
  useEffect(() => {
    captureDraftRef.current = captureDraft;
  }, [captureDraft]);
  // On unmount, FLUSH the pending mirror write instead of dropping it —
  // otherwise keystrokes in the last debounce window are lost to an immediate
  // navigation, the exact loss this exists to prevent.
  useEffect(
    () => () => {
      clearTimeout(captureDebounce.current);
      writeDraft("capture", meId, draftId, captureDraftRef.current);
    },
    [meId, draftId],
  );
  const onCaptureDraftChange = useCallback(
    (next: string) => {
      setCaptureDraft(next);
      clearTimeout(captureDebounce.current);
      captureDebounce.current = setTimeout(() => writeDraft("capture", meId, draftId, next), 400);
    },
    [meId, draftId],
  );

  // Rendered arc order: manual rank first, name tiebreak — so a focus whose
  // arcs nobody has dragged lists them alphabetically (PROG-87).
  const focusArcs = useMemo(
    () => arcs.filter((a) => a.focusId === focus.id && !a.archivedAt).sort(byRankThenName),
    [arcs, focus.id],
  );

  // Top-level (no-arc) forest, and one forest per arc. An arc-only embed
  // renders just its arc's forest, promoted to depth 0 (there's no section
  // header to indent under).
  const looseForest = useMemo(
    () => (arcOnly ? [] : buildForest(focusActions, focus.id, null, 0)),
    [focusActions, focus.id, arcOnly],
  );
  const arcForests = useMemo(
    () =>
      arcOnly
        ? [{ arc: arcOnly, forest: buildForest(focusActions, focus.id, arcOnly.id, 0) }]
        : focusArcs.map((a) => ({
            arc: a,
            forest: buildForest(focusActions, focus.id, a.id, 1),
          })),
    [focusActions, focus.id, focusArcs, arcOnly],
  );
  const arcItems = useMemo(() => focusArcs.map((a) => a.id), [focusArcs]);

  const actionById = useMemo(() => {
    const m = new Map<string, WireAction>();
    for (const i of actions) m.set(i.id, i);
    return m;
  }, [actions]);

  // Indent an existing action: nest it under its nearest preceding sibling.
  const indent = useCallback(
    (action: WireAction) => {
      const siblings = siblingsOf(actions, action.focusId, action.parentActionId, action.arcId);
      const idx = siblings.findIndex((i) => i.id === action.id);
      const prev = siblings[idx - 1];
      if (!prev) return; // nothing to nest under
      void updateAction(action.id, { parentActionId: prev.id, arcId: prev.arcId });
    },
    [actions],
  );

  // Outdent an existing action: hop up to its grandparent (or to top level).
  const outdent = useCallback(
    (action: WireAction) => {
      if (action.parentActionId === null) return; // already at the ceiling
      const parent = actionById.get(action.parentActionId);
      if (!parent) return;
      void updateAction(action.id, {
        parentActionId: parent.parentActionId,
        arcId: parent.arcId,
      });
    },
    [actionById],
  );

  // Capture-input deepen/shallow: move the new-bullet target down/up a level by
  // pointing it at the last action of the current sibling group.
  const deepen = useCallback(() => {
    const last = siblingsOf(actions, focus.id, captureParent, captureArc).at(-1);
    if (last) {
      setCaptureParent(last.id);
      setCaptureArc(last.arcId);
      // The capture input remounts at its new spot — keep the keyboard on it.
      setFocusToken((t) => t + 1);
    }
  }, [actions, focus.id, captureParent, captureArc]);
  const shallow = useCallback(() => {
    if (captureParent === null) {
      // Arc-scoped top-level capture: Shift+Tab pops out of the arc section to
      // the focus's loose level, completing the deepen/shallow ladder. In an
      // arc-only embed the arc IS the ceiling, so there's nowhere to pop to.
      if (captureArc !== null && !arcOnly) {
        setCaptureArc(null);
        setFocusToken((t) => t + 1);
      }
      return;
    }
    const parent = actionById.get(captureParent);
    setCaptureParent(parent ? parent.parentActionId : null);
    if (parent && parent.parentActionId === null) setCaptureArc(parent.arcId);
    setFocusToken((t) => t + 1);
  }, [actionById, captureParent, captureArc, arcOnly]);

  const create = useCallback(
    (title: string, parentActionId: string | null, arcId: string | null) => {
      // Status/priority/estimate/due default in the store (PROG-115): a fresh
      // capture lands in the backlog.
      createAction({ title, focusId: focus.id, arcId, parentActionId });
      // The draft became an action (optimistic row, store-owned retry/rollback) —
      // clear it and its mirror so it can't resurrect as a duplicate.
      clearTimeout(captureDebounce.current);
      setCaptureDraft("");
      clearDraft("capture", meId, draftId);
      setFocusToken((t) => t + 1);
    },
    [focus.id, meId, draftId],
  );

  // The render-isolation contexts (PROG-125): rows read their environment and
  // the roving capture state from here, so their memoization holds across drag
  // ticks and capture keystrokes. Both values are stable while a drag is live —
  // nothing in them changes mid-drag.
  const rowEnv = useMemo(
    () => ({ ws, arcs, onIndent: indent, onOutdent: outdent }),
    [ws, arcs, indent, outdent],
  );
  const onCreateUnder = useCallback(
    (title: string, parent: WireAction) => create(title, parent.id, parent.arcId),
    [create],
  );
  const captureEnv = useMemo(
    () => ({
      parentId: captureParent,
      draft: captureDraft,
      focusToken,
      onDraftChange: onCaptureDraftChange,
      onCreateUnder,
      onDeepen: deepen,
      onShallow: shallow,
    }),
    [captureParent, captureDraft, focusToken, onCaptureDraftChange, onCreateUnder, deepen, shallow],
  );

  // "Back to top level" shows whenever capture has roved anywhere off the
  // focus's loose level — under an action OR into an arc section (previously an
  // arc-scoped capture stranded the user: the loose capture row was hidden and
  // no affordance led back). An arc-only embed's top level is the arc itself.
  const captureAtTopLevel = arcOnly
    ? captureParent === null
    : captureParent === null && captureArc === null;
  const resetCapture = () => {
    setCaptureParent(null);
    setCaptureArc(arcOnly ? arcOnly.id : null);
    setFocusToken((t) => t + 1);
  };

  if (arcOnly) {
    const forest = arcForests[0]!.forest;
    return (
      <RowEnvContext.Provider value={rowEnv}>
        <CaptureContext.Provider value={captureEnv}>
          <Forest nodes={forest} />
          {captureParent === null && (
            <CaptureRow
              depth={0}
              placeholder={`New action in ${arcOnly.name} — Enter to add, Tab to nest`}
              draft={captureDraft}
              onDraftChange={onCaptureDraftChange}
              onCreate={(t) => create(t, null, arcOnly.id)}
              onDeepen={deepen}
              onShallow={shallow}
              focusToken={focusToken}
            />
          )}
          {!captureAtTopLevel && (
            <button
              onClick={resetCapture}
              className="mt-1 rounded px-1 py-0.5 text-xs text-ink-faint hover:bg-line hover:text-ink-soft"
            >
              ↥ back to top level
            </button>
          )}
        </CaptureContext.Provider>
      </RowEnvContext.Provider>
    );
  }

  return (
    // The providers sit at the section root so both the loose forest and every
    // arc forest read the same per-focus environment (PROG-125).
    <RowEnvContext.Provider value={rowEnv}>
      <CaptureContext.Provider value={captureEnv}>
        <section className={showHeader ? "rounded-lg border border-line bg-card p-3" : ""}>
          {showHeader && (
            <div className="group mb-1 flex items-center gap-2">
              {grip}
              <Link href={`/focus/${focus.id}`} className="font-medium text-ink hover:underline">
                {focus.name}
              </Link>
              <span className="font-mono text-[11px] text-ink-faint">{focus.keyPrefix}</span>
              {/* The mirrored repo, as Structure showed it (PROG-140): opens in a
                  new tab; stops propagation so it never triggers the section drag. */}
              {focus.gitUrl && (
                <a
                  href={focus.gitUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="max-w-[12rem] truncate font-mono text-[11px] text-ink-faint hover:text-ink-soft hover:underline"
                >
                  {focus.gitUrl.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
          )}

          {/* Focus-level (no-arc) actions + their roving capture row. All sortable
          wiring registers with the PAGE's single DndContext (PROG-118), so rows
          can be dropped across arc — and focus — section boundaries. */}
          <Forest nodes={looseForest} />
          {captureParent === null && captureArc === null && (
            <CaptureRow
              depth={0}
              placeholder="New action — Enter to add, Tab to nest under the one above"
              draft={captureDraft}
              onDraftChange={onCaptureDraftChange}
              onCreate={(t) => create(t, null, null)}
              onDeepen={deepen}
              onShallow={shallow}
              focusToken={focusToken}
            />
          )}

          {/* Arc sections — themselves drag-to-reorderable as whole blocks via the
          grip in their header (PROG-87); the page's onDragEnd branches on
          what's dragged. */}
          <SortableContext items={arcItems} strategy={verticalListSortingStrategy}>
            {arcForests.map(({ arc, forest }) => (
              <SortableSection
                key={arc.id}
                id={arc.id}
                kind="arc"
                href={`/arc/${arc.id}`}
                label={`Open ${arc.name} — drag to reorder`}
                className="mt-2"
              >
                {(arcGrip) => (
                  <>
                    <div className="group flex items-center gap-1.5">
                      {arcGrip}
                      <Link
                        href={`/arc/${arc.id}`}
                        className="text-sm font-medium text-moss-deep hover:underline"
                      >
                        {arc.name}
                      </Link>
                    </div>
                    <Forest nodes={forest} />
                    {captureParent === null && captureArc === arc.id && (
                      <CaptureRow
                        depth={1}
                        placeholder={`New action in ${arc.name}`}
                        draft={captureDraft}
                        onDraftChange={onCaptureDraftChange}
                        onCreate={(t) => create(t, null, arc.id)}
                        onDeepen={deepen}
                        onShallow={shallow}
                        focusToken={focusToken}
                      />
                    )}
                    {!(captureParent === null && captureArc === arc.id) && (
                      <button
                        onClick={() => {
                          setCaptureParent(null);
                          setCaptureArc(arc.id);
                          setFocusToken((t) => t + 1);
                        }}
                        className="ml-[22px] rounded px-1 py-0.5 text-xs text-ink-faint hover:bg-line hover:text-ink-soft"
                      >
                        + action here
                      </button>
                    )}
                  </>
                )}
              </SortableSection>
            ))}
          </SortableContext>

          {/* Inline arc creation (PROG-140): the capture idiom instead of a
              dialog — a text button expanding to a name input, Enter to add,
              Escape to collapse. */}
          {addingArc ? (
            <InlineCapture
              icon={<LevelIcon kind="arc" />}
              placeholder="New arc — Enter to add"
              onSubmit={(name) => createContainer({ kind: "arc", name, focusId: focus.id })}
              onCancel={() => setAddingArc(false)}
            />
          ) : (
            <button
              onClick={() => setAddingArc(true)}
              className="mt-1 ml-[30px] rounded px-1 py-0.5 text-xs text-ink-faint hover:bg-line hover:text-ink-soft"
            >
              + new arc
            </button>
          )}

          {/* When capture has roved off the top level, offer a way back. */}
          {!captureAtTopLevel && (
            <button
              onClick={resetCapture}
              className="mt-1 rounded px-1 py-0.5 text-xs text-ink-faint hover:bg-line hover:text-ink-soft"
            >
              ↥ back to top level
            </button>
          )}
        </section>
      </CaptureContext.Provider>
    </RowEnvContext.Provider>
  );
});

// ---------- the embeddable outline view (PROG-126) ----------

// The whole outline experience — nested forests, capture rows, the drag
// controller and its DragOverlay — for one scope, extracted from the /outline
// page so container pages embed the exact same component instead of a
// lookalike. A workspace scope renders its focuses as sortable sections
// (PROG-87); a focus scope renders that focus's loose level + arc sections;
// an arc scope renders just that arc's forest (FocusOutline's arcOnly mode).
export type OutlineViewScope =
  // The whole tree (PROG-140): every active workspace as a sortable section,
  // each holding its focus sections. The top of the outline's zoom stack.
  | { kind: "all" }
  | { kind: "workspace"; id: string }
  | { kind: "focus"; id: string }
  | { kind: "arc"; id: string };

export function OutlineView({
  snapshot,
  scope,
  hideDone,
}: {
  snapshot: SnapshotPayload;
  scope: OutlineViewScope;
  hideDone: boolean;
}) {
  // Manual rank first, name tiebreak (PROG-87) — alphabetical until the owner
  // starts dragging sections around, then the dragged order wins everywhere.
  const focuses = useMemo(
    () => [...snapshot.focuses].filter((p) => !p.archivedAt).sort(byRankThenName),
    [snapshot.focuses],
  );
  // Active workspaces in the same manual order (PROG-140): the all-scope
  // sections and their reorder both read this list.
  const workspaces = useMemo(
    () => [...snapshot.workspaces].filter((w) => !w.archivedAt).sort(byRankThenName),
    [snapshot.workspaces],
  );
  const focusesOfWorkspace = useCallback(
    (workspaceId: string) => focuses.filter((p) => p.workspaceId === workspaceId),
    [focuses],
  );
  // Every focus's prefix, for client-side dedupe of new-focus keys (PROG-140):
  // the per-workspace "+ new focus" capture lives inside this view at all scope.
  const existingPrefixes = useMemo(
    () => new Set(snapshot.focuses.map((p) => p.keyPrefix.toUpperCase())),
    [snapshot.focuses],
  );

  const arcOnly = scope.kind === "arc" ? snapshot.arcs.find((a) => a.id === scope.id) : undefined;
  // The flat focus list a non-all scope renders. All scope renders per-workspace
  // (focusesOfWorkspace) instead, so this stays empty there.
  const scopedFocuses =
    scope.kind === "focus"
      ? focuses.filter((p) => p.id === scope.id)
      : scope.kind === "workspace"
        ? focuses.filter((p) => p.workspaceId === scope.id)
        : scope.kind === "arc"
          ? // Arc scope: the arc's focus, even if archived — the arc page still
            // shows its actions, so its embed should too.
            snapshot.focuses.filter((p) => p.id === arcOnly?.focusId)
          : [];

  // ---------- the page-wide drag controller (PROG-86/87/118) ----------
  //
  // ONE DndContext for the whole page: focus sections, arc sections, and action
  // rows all register here (they used to be split across nested per-focus
  // contexts, which made a drag across section boundaries impossible). The
  // handlers branch on what was picked up: sections reorder among their
  // siblings as before, while an action row dropped outside its own sibling
  // group now MOVES there — into another arc, back to the loose level, or into
  // a whole different focus (PROG-118).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // What the forests render (PROG-77): with "hide done" on, completed actions
  // and their subtrees drop out. Drop targets resolve against this same list so
  // a drop slots among the rows the user actually sees.
  const visibleActions = useMemo(
    () => (hideDone ? snapshot.actions.filter((i) => isOpenStatus(i.status)) : snapshot.actions),
    [snapshot.actions, hideDone],
  );
  const actionById = useMemo(
    () => new Map(snapshot.actions.map((i) => [i.id, i])),
    [snapshot.actions],
  );
  const arcById = useMemo(() => new Map(snapshot.arcs.map((a) => [a.id, a])), [snapshot.arcs]);
  const focusById = useMemo(() => new Map(focuses.map((p) => [p.id, p])), [focuses]);
  const workspaceById = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces]);
  const rankOf = (id: string) => actionById.get(id)!.rank;

  // Whatever the drag is holding. While set, a DragOverlay carries a floating
  // preview of it (board-card pattern: instant pickup feedback that tracks the
  // pointer) and the page goes pointer-inert, so nothing hover-highlights
  // under the drag (PROG-87 polish).
  const [activeDrag, setActiveDrag] = useState<{
    kind: "workspace" | "focus" | "arc" | "action";
    id: string;
  } | null>(null);
  // A held action row's LIVE landing spot (PROG-118 polish). While the drag
  // hovers a different sibling group, the row is rendered *in that group* at
  // this position (see previewedActions), so the underlying rows slide apart to
  // show where it would land — across arcs and focuses, the board's
  // onDragOver-preview pattern (PROG-59). Null while the row is over its home
  // group, where dnd-kit's same-context sorting transforms show the gap.
  const [preview, setPreview] = useState<{
    focusId: string;
    arcId: string | null;
    parentActionId: string | null;
    rank: string;
    // Rank rewrites for tied neighbours at the previewed slot (PROG-129),
    // carried along so the drop can apply them; never written during preview.
    heal: Array<{ id: string; rank: string }>;
  } | null>(null);
  const clearDrag = () => {
    setActiveDrag(null);
    setPreview(null);
  };
  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (workspaceById.has(id)) setActiveDrag({ kind: "workspace", id });
    else if (focusById.has(id)) setActiveDrag({ kind: "focus", id });
    else if (arcById.has(id)) setActiveDrag({ kind: "arc", id });
    else if (actionById.has(id)) setActiveDrag({ kind: "action", id });
  };

  // What the forests actually render: while an action drag previews into
  // another group, the row is patched to that spot so the whole page reflects
  // the pending drop.
  const previewedActions = useMemo(() => {
    if (!preview || activeDrag?.kind !== "action") return visibleActions;
    const { focusId, arcId, parentActionId, rank } = preview;
    return visibleActions.map((a) =>
      a.id === activeDrag.id ? { ...a, focusId, arcId, parentActionId, rank } : a,
    );
  }, [visibleActions, activeDrag, preview]);

  // Each FocusOutline gets only ITS actions, with per-focus identity caching
  // (PROG-125): a preview hop patches one action, so only the source and
  // target focus get a fresh array — every other memoized FocusOutline keeps
  // its slice identity and skips re-rendering (and re-building forests).
  const sliceCache = useRef(new Map<string, WireAction[]>());
  const actionsByFocus = useMemo(() => {
    const next = new Map<string, WireAction[]>();
    for (const a of previewedActions) {
      const slice = next.get(a.focusId);
      if (slice) slice.push(a);
      else next.set(a.focusId, [a]);
    }
    for (const [focusId, slice] of next) {
      const prev = sliceCache.current.get(focusId);
      if (prev && prev.length === slice.length && prev.every((x, i) => x === slice[i]))
        next.set(focusId, prev);
    }
    sliceCache.current = next;
    return next;
  }, [previewedActions]);
  const EMPTY_ACTIONS = useRef<WireAction[]>([]).current;

  // A cross-focus move always lands top-level (the server detaches steps,
  // PROG-124) — so a drop over a step slots relative to its top-level root.
  const rootAncestorOf = (a: WireAction): WireAction => {
    let cursor = a;
    for (let hops = 0; cursor.parentActionId !== null && hops < 1000; hops++) {
      const parent = actionById.get(cursor.parentActionId);
      if (!parent) break;
      cursor = parent;
    }
    return cursor;
  };

  // One sibling group per key: steps group under their parent, top-level rows
  // under their (focus, arc) — mirrors siblingsOf's scoping rule.
  const groupKeyOf = (g: {
    focusId: string;
    arcId: string | null;
    parentActionId: string | null;
  }) =>
    g.parentActionId !== null
      ? `${g.focusId}/p:${g.parentActionId}`
      : `${g.focusId}/a:${g.arcId ?? "-"}`;

  // Where a dragged action would land if released over `overId`: the target
  // sibling group and a rank inside it. Rows resolve to their own group (their
  // top-level root's group when the row is in another focus — a move lands
  // top-level); arc/focus sections resolve to their top level, appended.
  // Returns null for an unresolvable or forbidden target (own subtree).
  const resolveActionDrop = (
    active: WireAction,
    overId: string,
    below: boolean,
  ): {
    focusId: string;
    arcId: string | null;
    parentActionId: string | null;
    rank: string;
    heal: Array<{ id: string; rank: string }>;
  } | null => {
    const target = (() => {
      const overAction = actionById.get(overId);
      if (overAction) {
        // Never into the action's own subtree — the reparent would cycle (the
        // server rejects it too; this guard skips the doomed write).
        if (inSubtreeOf(snapshot.actions, active.id, overId)) return null;
        const anchor =
          overAction.focusId === active.focusId ? overAction : rootAncestorOf(overAction);
        return {
          focusId: anchor.focusId,
          arcId: anchor.arcId,
          parentActionId: overAction.focusId === active.focusId ? anchor.parentActionId : null,
          anchorId: anchor.id,
        };
      }
      const overArc = arcById.get(overId);
      if (overArc)
        return {
          focusId: overArc.focusId,
          arcId: overArc.id,
          parentActionId: null,
          anchorId: overId,
        };
      const overFocus = focusById.get(overId);
      if (overFocus)
        return { focusId: overFocus.id, arcId: null, parentActionId: null, anchorId: overId };
      return null;
    })();
    if (!target) return null;
    // The group as rendered, without the active row; anchorId not in it (a
    // section id) means "append to the end" — rankForInsert's fallback.
    const group = siblingsOf(
      visibleActions,
      target.focusId,
      target.parentActionId,
      target.arcId,
    ).filter((i) => i.id !== active.id);
    const { anchorId, ...fields } = target;
    const placed = rankForInsert(
      group.map((i) => i.id),
      rankOf,
      anchorId,
      below,
    );
    return { ...fields, rank: placed.rank, heal: placed.heal };
  };

  // Pointer past the hovered target's vertical middle → land below it (the
  // board's cross-column rule); within one sibling group the index math
  // decides the side instead.
  const belowOf = (e: DragOverEvent | DragEndEvent) => {
    const translated = e.active.rect.current.translated;
    return translated && e.over ? translated.top > e.over.rect.top + e.over.rect.height / 2 : false;
  };

  // Live preview while an action row is held (the board's PROG-59 pattern):
  // when the hovered target resolves to a DIFFERENT sibling group, re-home the
  // row there so that group opens a slot. Inside one group (home or previewed)
  // this stays out of the way — dnd-kit's sorting transforms already animate
  // the gap, and re-rendering against them would fight.
  const onDragOver = (e: DragOverEvent) => {
    if (activeDrag?.kind !== "action") return;
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || overId === activeDrag.id) return;
    const active = actionById.get(activeDrag.id);
    if (!active) return;
    const resolved = resolveActionDrop(active, overId, belowOf(e));
    if (!resolved) return;
    const homeKey = groupKeyOf(active);
    const currentKey = preview ? groupKeyOf(preview) : homeKey;
    const targetKey = groupKeyOf(resolved);
    if (targetKey === currentKey) return;
    setPreview(targetKey === homeKey ? null : resolved);
  };

  // Any POINTER drag that activated may be tailed by a synthesized click at
  // the release point (PROG-130) — swallow it before it native-navigates. A
  // keyboard drag (Space pickup) is excluded: no click follows an Enter/Space
  // drop, and arming the swallower would eat the user's next real click.
  const guardDragTail = (e: DragEndEvent | DragCancelEvent) => {
    if (!(e.activatorEvent instanceof KeyboardEvent)) swallowNextClick();
  };

  // Guarded (PROG-129): a drop that fails to compute must land as a no-op,
  // never as an uncaught throw inside dnd-kit's drag-end batch — that left the
  // DndContext mid-flight and cascaded into a render loop that unmounted the
  // whole page.
  const onDragEnd = (e: DragEndEvent) => {
    guardDragTail(e);
    try {
      onDragEndInner(e);
    } catch (err) {
      console.error("drop failed", err);
    }
  };

  const onDragEndInner = (e: DragEndEvent) => {
    const dropPreview = activeDrag?.kind === "action" ? preview : null;
    clearDrag();
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;

    // -- A workspace section (all scope, PROG-140): reorder among the active
    //    workspaces. Resolve `over` up to its workspace the same way the focus
    //    branch resolves to a focus.
    if (workspaceById.has(activeId)) {
      const overWorkspaceId = workspaceById.has(overId)
        ? overId
        : (focusById.get(overId)?.workspaceId ??
          focusById.get(arcById.get(overId)?.focusId ?? "")?.workspaceId ??
          focusById.get(actionById.get(overId)?.focusId ?? "")?.workspaceId ??
          null);
      if (!overWorkspaceId || overWorkspaceId === activeId) return;
      const updates = containerReorderRanks(workspaces, activeId, overWorkspaceId);
      for (const u of updates ?? []) void updateContainer("workspace", u.id, { rank: u.rank });
      return;
    }

    // -- A focus section: reorder among its workspace's focuses, or — at all
    //    scope — re-parent when dropped into a DIFFERENT workspace (PROG-140).
    //    With closestCenter the `over` is often a row/arc inside a neighbouring
    //    section rather than the section itself — resolve it to its focus.
    if (focusById.has(activeId)) {
      const activeFocus = focusById.get(activeId)!;
      const overFocus =
        focusById.get(overId) ??
        focusById.get(arcById.get(overId)?.focusId ?? "") ??
        focusById.get(actionById.get(overId)?.focusId ?? "");
      const overWorkspaceId = overFocus?.workspaceId ?? (workspaceById.has(overId) ? overId : null);
      if (!overWorkspaceId) return;

      if (overWorkspaceId === activeFocus.workspaceId) {
        // Same workspace: reorder among its focuses. One write once ranks are
        // distinct; the first drag in a still-tied (alphabetical) group
        // renumbers the whole group — see containerReorder.
        if (!overFocus || overFocus.id === activeId) return;
        const updates = containerReorderRanks(
          focusesOfWorkspace(overWorkspaceId),
          activeId,
          overFocus.id,
        );
        for (const u of updates ?? []) void updateContainer("focus", u.id, { rank: u.rank });
        return;
      }

      // Dropped into another workspace: re-parent, slotting where dropped in the
      // target workspace's focus list. Safe because action keys derive from the
      // focus prefix, not the workspace (D18) — no re-keying (PROG-140).
      const targetFocuses = focusesOfWorkspace(overWorkspaceId).filter((p) => p.id !== activeId);
      const placed = rankForInsert(
        targetFocuses.map((p) => p.id),
        (id) => focusById.get(id)!.rank,
        overFocus ? overFocus.id : "",
        belowOf(e),
      );
      for (const h of placed.heal) void updateContainer("focus", h.id, { rank: h.rank });
      void updateContainer("focus", activeId, {
        workspaceId: overWorkspaceId,
        rank: placed.rank,
      });
      return;
    }

    // -- An arc section: reorder among its own focus's arcs. Only actions move
    //    between containers by drag (PROG-118); an arc dropped outside its
    //    focus stays put.
    const activeArc = arcById.get(activeId);
    if (activeArc) {
      const overArc = arcById.get(
        arcById.has(overId) ? overId : (actionById.get(overId)?.arcId ?? ""),
      );
      if (!overArc || overArc.focusId !== activeArc.focusId || overArc.id === activeId) return;
      const focusArcs = snapshot.arcs
        .filter((a) => a.focusId === activeArc.focusId && !a.archivedAt)
        .sort(byRankThenName);
      const updates = containerReorderRanks(focusArcs, activeId, overArc.id);
      for (const u of updates ?? []) void updateContainer("arc", u.id, { rank: u.rank });
      return;
    }

    // -- An action row (PROG-86/PROG-118). The row is committed where the
    //    preview left it: onDragOver has already resolved every cross-group
    //    hop, so by release the pending group is `dropPreview` (or home), and
    //    `over` only fine-tunes the position within it. Resolving `over` from
    //    scratch here would break exactly the way the board's PROG-59 fix
    //    describes — after a preview, `over` is usually the active row itself.
    const active = actionById.get(activeId);
    if (!active) return;
    const target = dropPreview ?? {
      focusId: active.focusId,
      arcId: active.arcId,
      parentActionId: active.parentActionId,
      rank: active.rank,
    };
    // The landing group as rendered at release (active row at its previewed
    // spot), so the within-group reorder math sees what the user saw.
    const listAtDrop = dropPreview
      ? visibleActions.map((a) =>
          a.id === activeId
            ? {
                ...a,
                focusId: dropPreview.focusId,
                arcId: dropPreview.arcId,
                parentActionId: dropPreview.parentActionId,
                rank: dropPreview.rank,
              }
            : a,
        )
      : visibleActions;
    const group = siblingsOf(listAtDrop, target.focusId, target.parentActionId, target.arcId);
    let reordered: ReorderPlacement | null = null;
    if (overId !== activeId && group.some((i) => i.id === overId)) {
      // Released over a sibling: mint a rank between its new neighbours — the
      // same shared `rank` the board writes, so this drag also moves the card
      // there and vice-versa (PROG-86). Recomputed from the group's REAL
      // stored ranks, so this also supersedes any hover-time heal.
      reordered = rankForReorder(
        group.map((i) => i.id),
        (id) => group.find((i) => i.id === id)!.rank,
        activeId,
        overId,
      );
    }
    // Tied neighbours at the slot (PROG-129): re-space them first, so the
    // active row's rank lands strictly between real, distinct keys.
    const heal = reordered?.heal ?? (dropPreview ? dropPreview.heal : []);
    for (const h of heal) void updateAction(h.id, { rank: h.rank });
    if (!dropPreview) {
      // Never left home: a plain same-group reorder, or a no-op click.
      if (reordered) void updateAction(activeId, { rank: reordered.rank });
      return;
    }
    const rank = reordered?.rank ?? dropPreview.rank;
    if (dropPreview.focusId === active.focusId) {
      // Same focus: join the previewed group right where shown — one
      // optimistic PATCH covers arc → arc, arc ↔ loose, and step groups.
      void updateAction(activeId, {
        arcId: target.arcId,
        parentActionId: target.parentActionId,
        rank,
      });
    } else {
      // Another focus: a real move (re-key + alias, steps detach —
      // PROG-102/PROG-124), landing top-level at the previewed spot.
      moveAction(activeId, { focusId: target.focusId, arcId: target.arcId, rank });
    }
  };

  // What the DragOverlay carries: a held workspace shows its focuses as rows, a
  // held focus its arcs, a held arc its action forest, a held action row its
  // step subtree — capped preview cards all four ways (PROG-140).
  const heldWorkspace =
    activeDrag?.kind === "workspace" ? workspaceById.get(activeDrag.id) : undefined;
  const heldFocus = activeDrag?.kind === "focus" ? focusById.get(activeDrag.id) : undefined;
  const heldArc = activeDrag?.kind === "arc" ? arcById.get(activeDrag.id) : undefined;
  const heldAction = activeDrag?.kind === "action" ? actionById.get(activeDrag.id) : undefined;
  const heldRows = heldWorkspace
    ? focusesOfWorkspace(heldWorkspace.id).map((p) => ({
        key: p.id,
        depth: 0,
        icon: <LevelIcon kind="focus" />,
        text: p.name,
      }))
    : heldFocus
      ? [...snapshot.arcs]
          .filter((a) => a.focusId === heldFocus.id && !a.archivedAt)
          .sort(byRankThenName)
          .map((a) => ({
            key: a.id,
            depth: 0,
            icon: <LevelIcon kind="arc" />,
            text: a.name,
          }))
      : heldArc
        ? forestPreviewRows(buildForest(visibleActions, heldArc.focusId, heldArc.id, 1))
        : heldAction
          ? actionSubtreeRows(visibleActions, heldAction.id)
          : [];

  // A workspace's focus sections as one SortableContext (PROG-87) — shared by
  // workspace scope (one workspace) and all scope (one per workspace, PROG-140),
  // so the two paths render focuses identically.
  const renderFocusSections = (wsFocuses: WireFocus[]) => (
    <SortableContext items={wsFocuses.map((p) => p.id)} strategy={verticalListSortingStrategy}>
      <div className="space-y-4">
        {wsFocuses.map((p) => (
          <SortableSection
            key={p.id}
            id={p.id}
            kind="focus"
            href={`/focus/${p.id}`}
            label={`Open ${p.name} — drag to reorder`}
          >
            {(focusGrip) => (
              <FocusOutline
                focus={p}
                ws={snapshot}
                focusActions={actionsByFocus.get(p.id) ?? EMPTY_ACTIONS}
                showHeader
                grip={focusGrip}
              />
            )}
          </SortableSection>
        ))}
      </div>
    </SortableContext>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      // The cross-group preview moves REAL layout mid-drag (rows re-home,
      // groups open a slot) — but the default WhileDragging measuring
      // already covers it: a hop remounts the moved subtree (the droppable
      // registry changes) and swaps the affected groups' SortableContext
      // items, both of which queue a re-measure, so later collisions see
      // the shifted rects. The previous MeasuringStrategy.Always only
      // added full re-measures of every row at mount and on idle
      // re-renders — pure overhead at outline scale (PROG-125).
      //
      // Tame the edge auto-scroll the same way the board does (PROG-79):
      // the default acceleration (10) fires scroll steps every 5ms, and at
      // outline scale each step's scroll-offset bookkeeping re-enters
      // before the last one finished — the drag "gets stuck" whenever the
      // pointer nears the viewport edge (PROG-125). acceleration 2 keeps
      // the scroll deliberate and the main thread breathing.
      autoScroll={{ acceleration: 2 }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={(e) => {
        guardDragTail(e);
        clearDrag();
      }}
    >
      {/* Pointer-inert while anything is held: no row hover highlights, no
          accidental input focus — the only live thing is the drag itself
          (PROG-87 polish). */}
      {scope.kind === "all" ? (
        // The whole tree (PROG-140): active workspaces as sortable sections, each
        // holding its own focus SortableContext + a "+ new focus" capture.
        <SortableContext items={workspaces.map((w) => w.id)} strategy={verticalListSortingStrategy}>
          <div className={`space-y-6 ${activeDrag ? "pointer-events-none select-none" : ""}`}>
            {workspaces.map((w) => (
              <SortableSection
                key={w.id}
                id={w.id}
                kind="workspace"
                href={`/workspace/${w.id}`}
                label={`Open ${w.name} — drag to reorder`}
              >
                {(wsGrip) => (
                  <section>
                    <div className="group mb-2 flex items-center gap-2">
                      {wsGrip}
                      <Link
                        href={`/workspace/${w.id}`}
                        className="text-lg font-semibold text-ink hover:underline"
                      >
                        {w.name}
                      </Link>
                    </div>
                    <div className="space-y-3 pl-1">
                      {renderFocusSections(focusesOfWorkspace(w.id))}
                      <NewFocusCapture workspaceId={w.id} existingPrefixes={existingPrefixes} />
                    </div>
                  </section>
                )}
              </SortableSection>
            ))}
          </div>
        </SortableContext>
      ) : scope.kind === "workspace" ? (
        <div className={activeDrag ? "pointer-events-none select-none" : undefined}>
          {renderFocusSections(scopedFocuses)}
        </div>
      ) : (
        <div className={activeDrag ? "pointer-events-none select-none" : undefined}>
          {scopedFocuses.map((p) => (
            <FocusOutline
              key={p.id}
              focus={p}
              ws={snapshot}
              focusActions={actionsByFocus.get(p.id) ?? EMPTY_ACTIONS}
              showHeader={false}
              arcOnly={scope.kind === "arc" ? arcOnly : undefined}
            />
          ))}
        </div>
      )}

      {/* The floating copy of whatever is held — section or action row:
              follows the pointer from the first pixel, lifted above the page
              (shadow), capped to a few rows. On release DROP_ANIMATION glides
              it into the committed slot (see its comment for why that no
              longer bounces back). */}
      <DragOverlay dropAnimation={DROP_ANIMATION}>
        {heldWorkspace ? (
          <SectionPreviewCard
            header={
              <>
                <LevelIcon kind="workspace" />
                <span className="font-semibold text-ink">{heldWorkspace.name}</span>
              </>
            }
            rows={heldRows}
            more={heldRows.length - PREVIEW_ROWS}
          />
        ) : heldFocus ? (
          <SectionPreviewCard
            header={
              <>
                <LevelIcon kind="focus" />
                <span className="font-medium text-ink">{heldFocus.name}</span>
                <span className="font-mono text-[11px] text-ink-faint">{heldFocus.keyPrefix}</span>
              </>
            }
            rows={heldRows}
            more={heldRows.length - PREVIEW_ROWS}
          />
        ) : heldArc ? (
          <SectionPreviewCard
            header={
              <>
                <LevelIcon kind="arc" />
                <span className="text-sm font-medium text-moss-deep">{heldArc.name}</span>
              </>
            }
            rows={heldRows}
            more={heldRows.length - PREVIEW_ROWS}
          />
        ) : heldAction ? (
          // The board card's held look (rotate + lift) on the row's own
          // anatomy, so what you grabbed is unmistakably in hand. Width
          // capped: the sortable node is a full-width row, but the thing
          // in hand should read as a card, not a page-wide slab.
          <div className="max-w-md rotate-1">
            <SectionPreviewCard
              header={
                <>
                  <LevelIcon kind={heldAction.parentActionId ? "sub" : "action"} />
                  <span
                    className={`truncate text-sm ${
                      isOpenStatus(heldAction.status) ? "text-ink" : CLOSED_TITLE_CLASS
                    }`}
                  >
                    {heldAction.title}
                  </span>
                </>
              }
              rows={heldRows}
              more={heldRows.length - PREVIEW_ROWS}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------- root picker + page ----------

type Root = { kind: "all" } | { kind: "focus"; id: string } | { kind: "workspace"; id: string };

export default function Outline({ snapshot }: { snapshot: SnapshotPayload }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const [focusFocus, setFocusFocus] = useState(0);

  // "Hide done" is a sticky per-user view preference (PROG-77): seed from
  // localStorage on mount, mirror back on every change so it survives navigating
  // away and returning. The key is shared with the container pages' embedded
  // views (PROG-126) — one preference everywhere.
  const [hideDone, setHideDone] = useState(loadHideDone);
  useEffect(() => saveHideDone(hideDone), [hideDone]);

  // Every focus's prefix, for client-side dedupe of new-focus keys.
  const existingPrefixes = useMemo(
    () => new Set(snapshot.focuses.map((p) => p.keyPrefix.toUpperCase())),
    [snapshot.focuses],
  );

  // Manual rank first, name tiebreak (PROG-87) — alphabetical until the owner
  // starts dragging sections around, then the dragged order wins everywhere.
  const focuses = useMemo(
    () => [...snapshot.focuses].filter((p) => !p.archivedAt).sort(byRankThenName),
    [snapshot.focuses],
  );
  const workspaces = useMemo(
    () => [...snapshot.workspaces].filter((i) => !i.archivedAt).sort(byRankThenName),
    [snapshot.workspaces],
  );

  // Resolve the active root: URL params win (links stay shareable), then the
  // sticky last-used scope (localStorage — so navigating away and back lands on
  // the same scope), then the whole tree. Every id is validated against live
  // data so a stale saved scope falls through instead of blanking the view. The
  // default is `all` (PROG-140) — the top of the zoom stack, not the first focus.
  const root: Root = useMemo(() => {
    if (params.get("all") === "1") return { kind: "all" };
    const prd = params.get("focus");
    const ini = params.get("workspace");
    if (prd && focuses.some((p) => p.id === prd)) return { kind: "focus", id: prd };
    if (ini && workspaces.some((i) => i.id === ini)) return { kind: "workspace", id: ini };
    const saved = loadScope();
    if (saved?.kind === "all") return { kind: "all" };
    if (saved?.kind === "focus" && focuses.some((p) => p.id === saved.id)) return saved;
    if (saved?.kind === "workspace" && workspaces.some((i) => i.id === saved.id)) return saved;
    return { kind: "all" };
  }, [search, focuses, workspaces]);

  // Mirror the resolved scope back to storage on every change — picking from
  // the dropdown, following a scoped link, or the fallback itself.
  useEffect(() => {
    saveScope(root);
  }, [root.kind, root.kind === "all" ? "" : root.id]);

  const setRoot = (value: string) => {
    if (value === "all") {
      navigate("/outline?all=1");
      return;
    }
    const [kind, id] = value.split(":");
    navigate("/outline?" + kind + "=" + id);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outline</h1>
          <p className="mt-1 text-xs text-ink-faint">
            Fast capture — type to add actions, <kbd>Enter</kbd> for the next, <kbd>Tab</kbd>/
            <kbd>Shift+Tab</kbd> to nest. Each row&apos;s bullet is its handle — tap it to open,
            drag it to reorder or drop it into another arc or focus.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
              className="h-3.5 w-3.5 accent-adobe-deep"
            />
            Hide done
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-faint">Scope</span>
            <select
              value={root.kind === "all" ? "all" : `${root.kind}:${root.id}`}
              onChange={(e) => setRoot(e.target.value)}
              className="rounded border border-line bg-card px-2 py-1 text-sm text-ink focus:outline-none"
            >
              {/* The whole tree first (PROG-140), then each workspace and its
                  focuses. */}
              <option value="all">All workspaces</option>
              {/* Focuses nest under their workspace (PROG-109) — each workspace
                  option is followed by its focuses, indented. Both levels stay
                  selectable; nbsp indentation because <option> padding isn't
                  styleable cross-browser. */}
              {workspaces.map((i) => (
                <Fragment key={i.id}>
                  <option value={`workspace:${i.id}`}>{i.name}</option>
                  {focuses
                    .filter((p) => p.workspaceId === i.id)
                    .map((p) => (
                      <option key={p.id} value={`focus:${p.id}`}>
                        {"\u00a0\u00a0\u00a0"}
                        {p.name}
                      </option>
                    ))}
                </Fragment>
              ))}
              {/* Active focuses whose workspace is archived would otherwise
                  vanish from the picker — keep them reachable at the end. */}
              {focuses.some((p) => !workspaces.some((i) => i.id === p.workspaceId)) && (
                <optgroup label="Other focuses">
                  {focuses
                    .filter((p) => !workspaces.some((i) => i.id === p.workspaceId))
                    .map((p) => (
                      <option key={p.id} value={`focus:${p.id}`}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <OutlineView snapshot={snapshot} scope={root} hideDone={hideDone} />

        {/* At workspace scope, focuses are the top ceiling — so offer inline
            focus capture (and seed the empty state). Focus scope has no
            level above the arc/action ceiling, so it shows nothing here. */}
        {root.kind === "workspace" && (
          <section className="rounded-lg border border-dashed border-line bg-card/40 p-3">
            {!focuses.some((p) => p.workspaceId === root.id) && (
              <p className="mb-1 text-sm text-ink-faint">
                No focuses yet — add the first one to start capturing.
              </p>
            )}
            <FocusCaptureRow
              workspaceId={root.id}
              existingPrefixes={existingPrefixes}
              focusToken={focusFocus}
              onCreated={() => setFocusFocus((t) => t + 1)}
            />
          </section>
        )}

        {/* At all scope, workspaces are the top ceiling — new-workspace capture
            lives on the page (outside OutlineView), mirroring the workspace-scope
            focus capture (PROG-140). */}
        {root.kind === "all" && (
          <section className="rounded-lg border border-dashed border-line bg-card/40 p-3">
            {workspaces.length === 0 && (
              <p className="mb-1 text-sm text-ink-faint">
                No workspaces yet — add the first one to start capturing.
              </p>
            )}
            <NewWorkspaceCapture />
          </section>
        )}
      </div>
    </div>
  );
}
