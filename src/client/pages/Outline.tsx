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
// full action/arc/focus page, press-and-drag reorders.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
  updateContainer,
  updateAction,
} from "../store";
import { clearDraft, readDraft, writeDraft } from "../drafts";
import { rankForReorder } from "../outlineReorder";
import { byRankThenName, containerReorderRanks } from "../containerReorder";
import { loadHideDone, loadScope, saveHideDone, saveScope } from "../outlinePrefs";
// Tree model + sibling rules live in outlineTree.ts (pure, unit-tested).
import { buildForest, siblingsOf, type OutlineNode as Node } from "../outlineTree";

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
      title="Open — drag to reorder"
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
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        [className, isDragging ? "opacity-30" : undefined].filter(Boolean).join(" ") || undefined
      }
    >
      {children(
        <Handle
          kind={kind}
          href={href}
          label={label}
          handleRef={setActivatorNodeRef}
          handleProps={{ ...attributes, ...listeners }}
        />,
      )}
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

// ---------- a single editable action row ----------

function ActionRow({
  node,
  ws,
  arcs,
  onIndent,
  onOutdent,
  handleRef,
  handleProps,
}: {
  node: Node;
  ws: SnapshotPayload;
  arcs: WireArc[];
  onIndent: (action: WireAction) => void;
  onOutdent: (action: WireAction) => void;
  // Drag-to-reorder wiring from the enclosing sortable (PROG-86). Lives on the
  // row's single bullet handle, not the whole row, so the title input stays
  // fully editable.
  handleRef: (el: HTMLElement | null) => void;
  handleProps: HTMLAttributes<HTMLElement>;
}) {
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
        handleProps={handleProps}
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
    </div>
  );
}

// ---------- sortable subtree block ----------

// One node of the forest as a sortable item (PROG-86). The whole SUBTREE (row +
// its descendants + the roving capture slot) is the sortable element, so
// dragging a parent visually carries its children as a block. The activator is
// the bullet handle inside ActionRow, so only it starts a drag — the title
// input keeps working normally. Reorder is constrained to siblings on drop
// (see FocusOutline.onDragEnd); reparenting stays on Tab/Shift+Tab.
function OutlineNode({
  node,
  ws,
  arcs,
  onIndent,
  onOutdent,
  renderForest,
  renderCapture,
}: {
  node: Node;
  ws: SnapshotPayload;
  arcs: WireArc[];
  onIndent: (action: WireAction) => void;
  onOutdent: (action: WireAction) => void;
  renderForest: (forest: Node[]) => ReactNode;
  renderCapture: (node: Node) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: node.action.id });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      <ActionRow
        node={node}
        ws={ws}
        arcs={arcs}
        onIndent={onIndent}
        onOutdent={onOutdent}
        handleRef={setActivatorNodeRef}
        handleProps={{ ...attributes, ...listeners }}
      />
      {renderForest(node.children)}
      {renderCapture(node)}
    </div>
  );
}

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

function FocusOutline({
  focus,
  ws,
  showHeader,
  hideDone,
  grip,
}: {
  focus: WireFocus;
  ws: SnapshotPayload;
  showHeader: boolean;
  hideDone: boolean;
  // At workspace scope the whole section is sortable (PROG-87); the enclosing
  // SortableSection hands its drag grip down to render in the header.
  grip?: ReactNode;
}) {
  const actions = ws.actions;
  const arcs = ws.arcs;
  // What the forest renders. When "hide done" is on, completed (done/canceled)
  // actions — and their subtrees, since a hidden parent never recurses — drop out
  // entirely (PROG-77). Capture/indent helpers keep working off the full
  // `actions` list so nesting math is unaffected by what's currently visible.
  const visibleActions = useMemo(
    () => (hideDone ? actions.filter((i) => isOpenStatus(i.status)) : actions),
    [actions, hideDone],
  );
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
  const onCaptureDraftChange = (next: string) => {
    setCaptureDraft(next);
    clearTimeout(captureDebounce.current);
    captureDebounce.current = setTimeout(() => writeDraft("capture", meId, focus.id, next), 400);
  };

  // Rendered arc order: manual rank first, name tiebreak — so a focus whose
  // arcs nobody has dragged lists them alphabetically (PROG-87).
  const focusArcs = useMemo(
    () => arcs.filter((a) => a.focusId === focus.id && !a.archivedAt).sort(byRankThenName),
    [arcs, focus.id],
  );

  // Top-level (no-arc) forest, and one forest per arc.
  const looseForest = useMemo(
    () => buildForest(visibleActions, focus.id, null, 0),
    [visibleActions, focus.id],
  );
  const arcForests = useMemo(
    () =>
      focusArcs.map((a) => ({
        arc: a,
        forest: buildForest(visibleActions, focus.id, a.id, 1),
      })),
    [visibleActions, focus.id, focusArcs],
  );

  const actionById = useMemo(() => {
    const m = new Map<string, WireAction>();
    for (const i of actions) m.set(i.id, i);
    return m;
  }, [actions]);

  // Indent an existing action: nest it under its nearest preceding sibling.
  const indent = (action: WireAction) => {
    const siblings = siblingsOf(actions, action.focusId, action.parentActionId, action.arcId);
    const idx = siblings.findIndex((i) => i.id === action.id);
    const prev = siblings[idx - 1];
    if (!prev) return; // nothing to nest under
    void updateAction(action.id, { parentActionId: prev.id, arcId: prev.arcId });
  };

  // Outdent an existing action: hop up to its grandparent (or to top level).
  const outdent = (action: WireAction) => {
    if (action.parentActionId === null) return; // already at the ceiling
    const parent = actionById.get(action.parentActionId);
    if (!parent) return;
    void updateAction(action.id, {
      parentActionId: parent.parentActionId,
      arcId: parent.arcId,
    });
  };

  // Drag-to-reorder (PROG-86). One PointerSensor covers mouse + touch from the
  // grip; the small distance keeps a stray tap on the handle from starting a
  // phantom drag. KeyboardSensor makes the focused handle arrow-key reorderable.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // The arc section currently held by a drag (PROG-87 polish). While set, a
  // DragOverlay carries a floating preview of the grouping and the rest of the
  // outline goes pointer-inert, so row hover highlights and inputs can't react
  // under the drag.
  const [activeArcId, setActiveArcId] = useState<string | null>(null);
  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (focusArcs.some((a) => a.id === id)) setActiveArcId(id);
  };

  // The visible sibling group an action belongs to, in rendered (rank) order —
  // exactly the set a drag is allowed to reorder within.
  const siblingGroup = (action: WireAction): WireAction[] =>
    siblingsOf(visibleActions, action.focusId, action.parentActionId, action.arcId);

  const onReorder = (e: DragEndEvent) => {
    setActiveArcId(null);
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || overId === activeId) return;

    // Arc sections share this DndContext with the action rows inside them
    // (PROG-87) — branch on what is actually being dragged.
    if (focusArcs.some((a) => a.id === activeId)) {
      // Resolve the drop target to an arc: with closestCenter the `over` is
      // often a row inside a neighbouring arc's section rather than its header.
      const overArcId = focusArcs.some((a) => a.id === overId)
        ? overId
        : (actionById.get(overId)?.arcId ?? null);
      if (!overArcId || overArcId === activeId) return;
      // One write once ranks are distinct; the first drag in a still-tied
      // (alphabetical) group renumbers the whole group — see containerReorder.
      const updates = containerReorderRanks(focusArcs, activeId, overArcId);
      for (const u of updates ?? []) void updateContainer("arc", u.id, { rank: u.rank });
      return;
    }

    const active = actionById.get(activeId);
    const over = actionById.get(overId);
    if (!active || !over) return;
    // Reorder only within one sibling group; a drop onto a row in another group
    // (a different parent/arc) is a no-op — reparenting stays on Tab/Shift+Tab,
    // matching the board's rank-only semantics (the action asks for up/down only).
    const sameGroup =
      active.focusId === over.focusId &&
      active.parentActionId === over.parentActionId &&
      (active.parentActionId !== null || active.arcId === over.arcId);
    if (!sameGroup) return;
    const group = siblingGroup(active);
    const newRank = rankForReorder(
      group.map((i) => i.id),
      (id) => actionById.get(id)!.rank,
      activeId,
      overId,
    );
    // Same shared `rank` the board writes — so this drag also moves the card on
    // the board, and a board drag moves the row here (PROG-86).
    if (newRank) void updateAction(activeId, { rank: newRank });
  };

  // Capture-input deepen/shallow: move the new-bullet target down/up a level by
  // pointing it at the last action of the current sibling group.
  const lastSiblingOf = (parentId: string | null, arcId: string | null): WireAction | undefined =>
    siblingsOf(actions, focus.id, parentId, arcId).at(-1);
  const deepen = () => {
    const last = lastSiblingOf(captureParent, captureArc);
    if (last) {
      setCaptureParent(last.id);
      setCaptureArc(last.arcId);
      // The capture input remounts at its new spot — keep the keyboard on it.
      setFocusToken((t) => t + 1);
    }
  };
  const shallow = () => {
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
  };

  const create = (title: string, parentActionId: string | null, arcId: string | null) => {
    // Status/priority/estimate/due default in the store (PROG-115): a fresh
    // capture lands in the backlog.
    createAction({ title, focusId: focus.id, arcId, parentActionId });
    // The draft became an action (optimistic row, store-owned retry/rollback) —
    // clear it and its mirror so it can't resurrect as a duplicate.
    clearTimeout(captureDebounce.current);
    setCaptureDraft("");
    clearDraft("capture", meId, focus.id);
    setFocusToken((t) => t + 1);
  };

  // The roving capture input, dropped after the subtree of whichever action the
  // capture currently targets.
  const renderCapture = (node: Node) =>
    captureParent === node.action.id ? (
      <CaptureRow
        depth={node.depth + 1}
        placeholder="New step — Enter to add, Shift+Tab to outdent"
        draft={captureDraft}
        onDraftChange={onCaptureDraftChange}
        onCreate={(t) => create(t, node.action.id, node.action.arcId)}
        onDeepen={deepen}
        onShallow={shallow}
        focusToken={focusToken}
      />
    ) : null;

  // Render a sibling group as a SortableContext so its rows reorder within it
  // (PROG-86); recurses through each node's children (their own group/context).
  const renderForest = (forest: Node[]): ReactNode => {
    if (forest.length === 0) return null;
    return (
      <SortableContext
        items={forest.map((n) => n.action.id)}
        strategy={verticalListSortingStrategy}
      >
        {forest.map((node) => (
          <OutlineNode
            key={node.action.id}
            node={node}
            ws={ws}
            arcs={arcs}
            onIndent={indent}
            onOutdent={outdent}
            renderForest={renderForest}
            renderCapture={renderCapture}
          />
        ))}
      </SortableContext>
    );
  };

  // "Back to top level" shows whenever capture has roved anywhere off the
  // focus's loose level — under an action OR into an arc section (previously an
  // arc-scoped capture stranded the user: the loose capture row was hidden and
  // no affordance led back).
  const captureAtTopLevel = captureParent === null && captureArc === null;

  return (
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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onReorder}
        onDragCancel={() => setActiveArcId(null)}
      >
        {/* While an arc section is held, everything under it goes pointer-inert:
          no row hover highlights, no accidental input focus — the only live
          thing is the drag itself (PROG-87 polish). */}
        <div className={activeArcId ? "pointer-events-none select-none" : undefined}>
          {/* Focus-level (no-arc) actions + their roving capture row. */}
          {renderForest(looseForest)}
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
          grip in their header (PROG-87), inside the same DndContext as the
          action rows (onReorder branches on what's dragged). */}
          <SortableContext
            items={arcForests.map(({ arc }) => arc.id)}
            strategy={verticalListSortingStrategy}
          >
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
                    {renderForest(forest)}
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
        </div>

        {/* The floating copy of the held arc section: follows the pointer from
          the first pixel, lifted above the page (shadow), capped to a few rows.
          dropAnimation={null} for the same reason as the board (PROG-43): the
          reorder is committed on drop, so the default tween would fly the card
          back to its OLD slot before snapping. */}
        <DragOverlay dropAnimation={null}>
          {(() => {
            const held = activeArcId
              ? arcForests.find(({ arc }) => arc.id === activeArcId)
              : undefined;
            if (!held) return null;
            const rows = forestPreviewRows(held.forest);
            return (
              <SectionPreviewCard
                header={
                  <>
                    <LevelIcon kind="arc" />
                    <span className="text-sm font-medium text-moss-deep">{held.arc.name}</span>
                  </>
                }
                rows={rows}
                more={rows.length - PREVIEW_ROWS}
              />
            );
          })()}
        </DragOverlay>
      </DndContext>
    </section>
  );
}

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

  // At workspace scope the focus sections are drag-to-reorderable (PROG-87).
  // This outer DndContext nests around each FocusOutline's own context; the
  // focus grip is the only activator registered here, so arc/action drags
  // inside a section never reach this handler.
  const focusSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeFocusId, setActiveFocusId] = useState<string | null>(null);
  const onFocusReorder = (e: DragEndEvent) => {
    setActiveFocusId(null);
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || overId === activeId) return;
    const updates = containerReorderRanks(scopedFocuses, activeId, overId);
    for (const u of updates ?? []) void updateContainer("focus", u.id, { rank: u.rank });
  };

  // Overlay preview for a held focus section: its arcs as rows (the level a
  // focus grouping is made of), matching the arc previews' capped card.
  const heldFocus = activeFocusId ? scopedFocuses.find((p) => p.id === activeFocusId) : undefined;
  const heldFocusRows = heldFocus
    ? [...snapshot.arcs]
        .filter((a) => a.focusId === heldFocus.id && !a.archivedAt)
        .sort(byRankThenName)
        .map((a) => ({
          key: a.id,
          depth: 0,
          icon: <LevelIcon kind="arc" />,
          text: a.name,
        }))
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outline</h1>
          <p className="mt-1 text-xs text-ink-faint">
            Fast capture — type to add actions, <kbd>Enter</kbd> for the next, <kbd>Tab</kbd>/
            <kbd>Shift+Tab</kbd> to nest. Each row&apos;s bullet is its handle — tap it to open,
            drag it to reorder.
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

        {root?.kind === "workspace" ? (
          <DndContext
            sensors={focusSensors}
            collisionDetection={closestCenter}
            onDragStart={(e: DragStartEvent) => setActiveFocusId(String(e.active.id))}
            onDragEnd={onFocusReorder}
            onDragCancel={() => setActiveFocusId(null)}
          >
            <SortableContext
              items={scopedFocuses.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {/* Pointer-inert while a focus section is held — see the arc
                  drag's identical wrapper (PROG-87 polish). */}
              <div
                className={`space-y-4 ${activeFocusId ? "pointer-events-none select-none" : ""}`}
              >
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
                        showHeader
                        hideDone={hideDone}
                        grip={focusGrip}
                      />
                    )}
                  </SortableSection>
                ))}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {heldFocus && (
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
                  rows={heldFocusRows}
                  more={heldFocusRows.length - PREVIEW_ROWS}
                />
              )}
            </DragOverlay>
          </DndContext>
        ) : (
          scopedFocuses.map((p) => (
            <FocusOutline
              key={p.id}
              focus={p}
              ws={snapshot}
              showHeader={false}
              hideDone={hideDone}
            />
          ))
        )}

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
