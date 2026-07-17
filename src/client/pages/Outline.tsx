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
import PriorityIndicator from "../PriorityIndicator";
import StatusIndicator from "../StatusIndicator";
import { DROP_ANIMATION } from "../dropAnimation";
import { rankForInsert, rankForReorder } from "../outlineReorder";
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

function LevelIcon({ kind }: { kind: "focus" | "arc" | "action" | "sub" }) {
  const cls = "h-3.5 w-3.5 shrink-0";
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
  kind: "focus" | "arc" | "action" | "sub";
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
  kind: "focus" | "arc";
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
          sits just inside it and, as on the board, "none" renders nothing
          rather than a faint zero-bar glyph on every fresh capture. */}
      <span className="flex shrink-0 items-center gap-1.5">
        {action.priority !== "none" && <PriorityIndicator priority={action.priority} />}
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
}: {
  workspaceId: string;
  existingPrefixes: Set<string>;
  focusToken: number;
  onCreated: () => void;
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
}) {
  const actions = ws.actions;
  const arcs = ws.arcs;
  // The roving capture target: which action the next new bullet nests under
  // (null = focus top level, no arc). `captureArc` scopes a top-level new
  // bullet to an arc section. Re-validated against live data each render.
  const [captureParent, setCaptureParent] = useState<string | null>(null);
  const [captureArc, setCaptureArc] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);

  // The unsent capture text (PROG-107). Lifted out of CaptureRow so it survives
  // the input remounting as capture roves, and mirrored to localStorage
  // (debounced — the PROG-51 drafts pattern, same 400ms as comment drafts) so
  // typed-but-not-Entered text also survives scope switches, navigation, and
  // reloads. Cleared only once the action is actually created.
  const meId = ws.me?.id ?? "anon";
  const [captureDraft, setCaptureDraft] = useState(() => readDraft("capture", meId, focus.id));
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
      writeDraft("capture", meId, focus.id, captureDraftRef.current);
    },
    [meId, focus.id],
  );
  const onCaptureDraftChange = useCallback(
    (next: string) => {
      setCaptureDraft(next);
      clearTimeout(captureDebounce.current);
      captureDebounce.current = setTimeout(() => writeDraft("capture", meId, focus.id, next), 400);
    },
    [meId, focus.id],
  );

  // Rendered arc order: manual rank first, name tiebreak — so a focus whose
  // arcs nobody has dragged lists them alphabetically (PROG-87).
  const focusArcs = useMemo(
    () => arcs.filter((a) => a.focusId === focus.id && !a.archivedAt).sort(byRankThenName),
    [arcs, focus.id],
  );

  // Top-level (no-arc) forest, and one forest per arc.
  const looseForest = useMemo(
    () => buildForest(focusActions, focus.id, null, 0),
    [focusActions, focus.id],
  );
  const arcForests = useMemo(
    () =>
      focusArcs.map((a) => ({
        arc: a,
        forest: buildForest(focusActions, focus.id, a.id, 1),
      })),
    [focusActions, focus.id, focusArcs],
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
      // the focus's loose level, completing the deepen/shallow ladder.
      if (captureArc !== null) {
        setCaptureArc(null);
        setFocusToken((t) => t + 1);
      }
      return;
    }
    const parent = actionById.get(captureParent);
    setCaptureParent(parent ? parent.parentActionId : null);
    if (parent && parent.parentActionId === null) setCaptureArc(parent.arcId);
    setFocusToken((t) => t + 1);
  }, [actionById, captureParent, captureArc]);

  const create = useCallback(
    (title: string, parentActionId: string | null, arcId: string | null) => {
      // Status/priority/estimate/due default in the store (PROG-115): a fresh
      // capture lands in the backlog.
      createAction({ title, focusId: focus.id, arcId, parentActionId });
      // The draft became an action (optimistic row, store-owned retry/rollback) —
      // clear it and its mirror so it can't resurrect as a duplicate.
      clearTimeout(captureDebounce.current);
      setCaptureDraft("");
      clearDraft("capture", meId, focus.id);
      setFocusToken((t) => t + 1);
    },
    [focus.id, meId],
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
  // no affordance led back).
  const captureAtTopLevel = captureParent === null && captureArc === null;

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

          {/* When capture has roved off the top level, offer a way back. */}
          {!captureAtTopLevel && (
            <button
              onClick={() => {
                setCaptureParent(null);
                setCaptureArc(null);
                setFocusToken((t) => t + 1);
              }}
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

// ---------- root picker + page ----------

type Root = { kind: "focus"; id: string } | { kind: "workspace"; id: string };

export default function Outline({ snapshot }: { snapshot: SnapshotPayload }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const [focusFocus, setFocusFocus] = useState(0);

  // "Hide done" is a sticky per-user view preference (PROG-77): seed from
  // localStorage on mount, mirror back on every change so it survives navigating
  // away and returning.
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
  // the same scope), then the first focus. Every id is validated against
  // live data so a stale saved scope falls through instead of blanking the view.
  const root: Root | null = useMemo(() => {
    const prd = params.get("focus");
    const ini = params.get("workspace");
    if (prd && focuses.some((p) => p.id === prd)) return { kind: "focus", id: prd };
    if (ini && workspaces.some((i) => i.id === ini)) return { kind: "workspace", id: ini };
    const saved = loadScope();
    if (saved?.kind === "focus" && focuses.some((p) => p.id === saved.id)) return saved;
    if (saved?.kind === "workspace" && workspaces.some((i) => i.id === saved.id)) return saved;
    if (focuses[0]) return { kind: "focus", id: focuses[0].id };
    if (workspaces[0]) return { kind: "workspace", id: workspaces[0].id };
    return null;
  }, [search, focuses, workspaces]);

  // Mirror the resolved scope back to storage on every change — picking from
  // the dropdown, following a scoped link, or the fallback itself.
  useEffect(() => {
    if (root) saveScope(root);
  }, [root?.kind, root?.id]);

  const setRoot = (value: string) => {
    const [kind, id] = value.split(":");
    navigate(`/outline?${kind}=${id}`);
  };

  const scopedFocuses =
    root?.kind === "focus"
      ? focuses.filter((p) => p.id === root.id)
      : root?.kind === "workspace"
        ? focuses.filter((p) => p.workspaceId === root.id)
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
  const rankOf = (id: string) => actionById.get(id)!.rank;

  // Whatever the drag is holding. While set, a DragOverlay carries a floating
  // preview of it (board-card pattern: instant pickup feedback that tracks the
  // pointer) and the page goes pointer-inert, so nothing hover-highlights
  // under the drag (PROG-87 polish).
  const [activeDrag, setActiveDrag] = useState<{
    kind: "focus" | "arc" | "action";
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
  } | null>(null);
  const clearDrag = () => {
    setActiveDrag(null);
    setPreview(null);
  };
  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (focusById.has(id)) setActiveDrag({ kind: "focus", id });
    else if (arcById.has(id)) setActiveDrag({ kind: "arc", id });
    else if (actionById.has(id)) setActiveDrag({ kind: "action", id });
  };

  // What the forests actually render: while an action drag previews into
  // another group, the row is patched to that spot so the whole page reflects
  // the pending drop.
  const previewedActions = useMemo(() => {
    if (!preview || activeDrag?.kind !== "action") return visibleActions;
    return visibleActions.map((a) => (a.id === activeDrag.id ? { ...a, ...preview } : a));
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
    return {
      ...fields,
      rank: rankForInsert(
        group.map((i) => i.id),
        rankOf,
        anchorId,
        below,
      ),
    };
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

  const onDragEnd = (e: DragEndEvent) => {
    const dropPreview = activeDrag?.kind === "action" ? preview : null;
    clearDrag();
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;

    // -- A focus section (workspace scope): reorder among the visible focuses.
    //    With closestCenter the `over` is often a row/arc inside a neighbouring
    //    section rather than the section itself — resolve it to its focus.
    if (focusById.has(activeId)) {
      const overFocusId = focusById.has(overId)
        ? overId
        : (arcById.get(overId)?.focusId ?? actionById.get(overId)?.focusId ?? null);
      if (!overFocusId || overFocusId === activeId) return;
      // One write once ranks are distinct; the first drag in a still-tied
      // (alphabetical) group renumbers the whole group — see containerReorder.
      const updates = containerReorderRanks(scopedFocuses, activeId, overFocusId);
      for (const u of updates ?? []) void updateContainer("focus", u.id, { rank: u.rank });
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
      ? visibleActions.map((a) => (a.id === activeId ? { ...a, ...dropPreview } : a))
      : visibleActions;
    const group = siblingsOf(listAtDrop, target.focusId, target.parentActionId, target.arcId);
    let reordered: string | null = null;
    if (overId !== activeId && group.some((i) => i.id === overId)) {
      // Released over a sibling: mint a rank between its new neighbours — the
      // same shared `rank` the board writes, so this drag also moves the card
      // there and vice-versa (PROG-86).
      reordered = rankForReorder(
        group.map((i) => i.id),
        (id) => group.find((i) => i.id === id)!.rank,
        activeId,
        overId,
      );
    }
    if (!dropPreview) {
      // Never left home: a plain same-group reorder, or a no-op click.
      if (reordered) void updateAction(activeId, { rank: reordered });
      return;
    }
    const rank = reordered ?? dropPreview.rank;
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

  // What the DragOverlay carries: a held focus shows its arcs as rows, a held
  // arc its action forest, a held action row its step subtree — capped preview
  // cards all three ways.
  const heldFocus = activeDrag?.kind === "focus" ? focusById.get(activeDrag.id) : undefined;
  const heldArc = activeDrag?.kind === "arc" ? arcById.get(activeDrag.id) : undefined;
  const heldAction = activeDrag?.kind === "action" ? actionById.get(activeDrag.id) : undefined;
  const heldRows = heldFocus
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
              value={root ? `${root.kind}:${root.id}` : ""}
              onChange={(e) => setRoot(e.target.value)}
              className="rounded border border-line bg-card px-2 py-1 text-sm text-ink focus:outline-none"
            >
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
        {!root && <p className="text-sm text-ink-faint">No focuses or workspaces yet.</p>}

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
          onDragCancel={clearDrag}
        >
          {root?.kind === "workspace" ? (
            <SortableContext
              items={scopedFocuses.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {/* Pointer-inert while anything is held: no row hover
                  highlights, no accidental input focus — the only live thing
                  is the drag itself (PROG-87 polish). */}
              <div className={`space-y-4 ${activeDrag ? "pointer-events-none select-none" : ""}`}>
                {scopedFocuses.map((p) => (
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
          ) : (
            <div className={activeDrag ? "pointer-events-none select-none" : undefined}>
              {scopedFocuses.map((p) => (
                <FocusOutline
                  key={p.id}
                  focus={p}
                  ws={snapshot}
                  focusActions={actionsByFocus.get(p.id) ?? EMPTY_ACTIONS}
                  showHeader={false}
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
            {heldFocus ? (
              <SectionPreviewCard
                header={
                  <>
                    <LevelIcon kind="focus" />
                    <span className="font-medium text-ink">{heldFocus.name}</span>
                    <span className="font-mono text-[11px] text-ink-faint">
                      {heldFocus.keyPrefix}
                    </span>
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

        {/* At workspace scope, focuses are the top ceiling — so offer inline
            focus capture (and seed the empty state). Focus scope has no
            level above the arc/action ceiling, so it shows nothing here. */}
        {root?.kind === "workspace" && (
          <section className="rounded-lg border border-dashed border-line bg-card/40 p-3">
            {scopedFocuses.length === 0 && (
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
      </div>
    </div>
  );
}
