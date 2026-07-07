// Outline capture view (PROG-124, docs/intent/outline-capture.md): a
// Workflowy-style outliner for fast keyboard capture of issues as nested
// bullets. One Issue data type — a sub-issue is just an issue with a
// `parentIssueId`. The root picker scopes to an Initiative or a Product and
// sets the ceiling (Product root → Arc/Issue/Sub-issue; Initiative root →
// Product/Arc/Issue/Sub-issue). A fresh bullet is always an Issue; Arc/Product
// are reached only by the explicit "→ Arc" / structure controls, never typed.
//
// Capture loop: type in the trailing "+ new bullet" → Enter creates an issue
// and keeps focus for the next sibling; Tab on that bullet deepens it under the
// last sibling (→ sub-issue), Shift+Tab pops back up. Existing rows rename on
// Enter/blur and reparent in place via Tab/Shift+Tab. Nothing here deletes or
// archives — the far-left `⋯` (a per-row link, tappable on mobile) opens the
// full issue page.

import { useEffect, useMemo, useRef, useState } from "react";
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
import type { WireArc, WireIssue, WireProduct } from "../../shared/types";
import type { SnapshotPayload } from "../../shared/types";
import { isOpenStatus } from "../../shared/constants";
import {
  createContainer,
  createIssue,
  issueKeyOf,
  updateContainer,
  updateIssue,
} from "../store";
import { rankForReorder } from "../outlineReorder";
import { byRankThenName, containerReorderRanks } from "../containerReorder";
import { loadHideDone, loadScope, saveHideDone, saveScope } from "../outlinePrefs";

// ---------- tree model ----------

type Node = { issue: WireIssue; children: Node[]; depth: number };

// Build the child forest for a given parent within one product. `arcId` scopes
// the top level (null = product-level issues with no arc); deeper levels follow
// parentIssueId regardless of arc (a sub-issue inherits its parent's arc).
function buildForest(
  issues: WireIssue[],
  productId: string,
  parentIssueId: string | null,
  arcId: string | null,
  depth: number,
): Node[] {
  const matches = issues.filter((i) =>
    i.productId === productId &&
    i.parentIssueId === parentIssueId &&
    (parentIssueId === null ? i.arcId === arcId : true),
  );
  matches.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.number - b.number));
  return matches.map((issue) => ({
    issue,
    depth,
    children: buildForest(issues, productId, issue.id, arcId, depth + 1),
  }));
}

// ---------- level icons ----------

function LevelIcon({ kind }: { kind: "product" | "arc" | "issue" | "sub" }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (kind === "product")
    return (
      <svg viewBox="0 0 16 16" className={`${cls} text-adobe-deep`} fill="currentColor" aria-hidden>
        <rect x="2" y="2" width="12" height="12" rx="2.5" />
      </svg>
    );
  if (kind === "arc")
    return (
      <svg viewBox="0 0 16 16" className={`${cls} text-moss`} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M8 2.5 14 6 8 9.5 2 6 8 2.5Z" />
        <path d="M2 10l6 3.5L14 10" />
      </svg>
    );
  if (kind === "issue")
    return (
      <svg viewBox="0 0 16 16" className={`${cls} text-ink-faint`} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <circle cx="8" cy="8" r="4.5" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" className={`${cls} text-ink-faint`} fill="currentColor" aria-hidden>
      <circle cx="8" cy="8" r="2.5" />
    </svg>
  );
}

// ---------- drag-to-reorder building blocks ----------

// The 6-dot drag grip that starts a sortable drag (PROG-86/PROG-87). touch-none
// so a drag from the grip reorders instead of scrolling the page; always shown
// on mobile (no hover), faint until row hover/focus on desktop to keep the
// outline calm.
function GripHandle({
  label,
  handleRef,
  handleProps,
}: {
  label: string;
  handleRef: (el: HTMLElement | null) => void;
  handleProps: HTMLAttributes<HTMLElement>;
}) {
  return (
    <button
      ref={handleRef}
      {...handleProps}
      type="button"
      aria-label={label}
      title="Drag to reorder"
      className="flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-ink-faint/70 hover:bg-line hover:text-ink-soft active:cursor-grabbing sm:opacity-40 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
        <circle cx="6" cy="4" r="1.3" />
        <circle cx="10" cy="4" r="1.3" />
        <circle cx="6" cy="8" r="1.3" />
        <circle cx="10" cy="8" r="1.3" />
        <circle cx="6" cy="12" r="1.3" />
        <circle cx="10" cy="12" r="1.3" />
      </svg>
    </button>
  );
}

// A container section (an arc's block, or a whole product at initiative scope)
// as a sortable unit (PROG-87): the section moves as one block, and only the
// grip handed to `children` starts a drag, so the header's link and everything
// inside keep working normally.
function SortableSection({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: (grip: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id });
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
      className={[className, isDragging ? "opacity-30" : undefined].filter(Boolean).join(" ") || undefined}
    >
      {children(
        <GripHandle
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
          <span className={`truncate text-sm ${r.done ? "text-ink-faint line-through" : "text-ink"}`}>
            {r.text}
          </span>
        </div>
      ))}
      {more > 0 && (
        <div className="py-0.5 pl-2 text-xs text-ink-faint">… {more} more</div>
      )}
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
        key: n.issue.id,
        depth: n.depth,
        icon: <LevelIcon kind={n.depth === 0 ? "issue" : "sub"} />,
        text: n.issue.title,
        done: !isOpenStatus(n.issue.status),
      });
      walk(n.children);
    }
  };
  walk(forest);
  return rows;
}

// ---------- arc promotion control ----------

function ArcMenu({ issue, arcs }: { issue: WireIssue; arcs: WireArc[] }) {
  const [open, setOpen] = useState(false);
  const productArcs = arcs.filter((a) => a.productId === issue.productId && !a.archivedAt);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Assign to an arc"
        className="rounded px-1 text-xs text-ink-faint hover:bg-line hover:text-ink-soft"
      >
        {issue.arcId ? "arc ▾" : "→ arc"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-1 w-48 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-xl">
            {productArcs.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setOpen(false);
                  void updateIssue(issue.id, { arcId: a.id });
                }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-line ${issue.arcId === a.id ? "text-adobe-deep" : "text-ink-soft"}`}
              >
                {a.name}
              </button>
            ))}
            <button
              onClick={() => {
                setOpen(false);
                const name = window.prompt("New arc name");
                if (name && name.trim()) {
                  const id = createContainer({ kind: "arc", name: name.trim(), productId: issue.productId });
                  void updateIssue(issue.id, { arcId: id });
                }
              }}
              className="block w-full border-t border-line px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-line"
            >
              + New arc…
            </button>
            {issue.arcId && (
              <button
                onClick={() => {
                  setOpen(false);
                  void updateIssue(issue.id, { arcId: null });
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

// ---------- a single editable issue row ----------

function IssueRow({
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
  onIndent: (issue: WireIssue) => void;
  onOutdent: (issue: WireIssue) => void;
  // Drag-to-reorder handle wiring from the enclosing sortable (PROG-86). Lives on
  // a dedicated grip, not the whole row, so the title input stays fully editable.
  handleRef: (el: HTMLElement | null) => void;
  handleProps: HTMLAttributes<HTMLElement>;
}) {
  const { issue, depth } = node;
  // Completed (done/canceled) issues stay visible but read as "finished": lower
  // contrast + strikethrough (PROG-77). The whole-page "hide done" toggle drops
  // them from the forest entirely; this styling is only reached when they show.
  const done = !isOpenStatus(issue.status);
  const [draft, setDraft] = useState(issue.title);
  // Keep the input in sync if the title changes elsewhere (e.g. server reconcile)
  // while this row isn't focused.
  useEffect(() => setDraft(issue.title), [issue.title]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== issue.title) void updateIssue(issue.id, { title: next });
    else if (!next) setDraft(issue.title); // never blank a saved issue
  };

  const issueKey = issueKeyOf(ws, issue);

  return (
    <div
      className="group flex items-center gap-1.5 rounded py-0.5 hover:bg-line/30"
      style={{ paddingLeft: depth * 22 }}
    >
      {/* Drag handle (PROG-86). */}
      <GripHandle label={`Reorder ${issueKey}`} handleRef={handleRef} handleProps={handleProps} />
      {/* Jump-to-issue affordance, pinned to the far left so it sits in a
          consistent gutter and — crucially — is reachable on touch, where there
          is no hover to reveal it (PROG-80). Always shown on mobile; on desktop
          it rests faint and firms up on row hover/focus to keep the outline
          calm. Tapping the same three dots that used to hide on the right edge. */}
      <Link
        href={`/issue/${issueKey}`}
        title="Open full issue"
        aria-label={`Open issue ${issueKey}`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-line hover:text-ink-soft sm:opacity-40 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:focus-visible:opacity-100"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </Link>
      <LevelIcon kind={depth === 0 ? "issue" : "sub"} />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            commit();
            onIndent(issue);
          } else if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            commit();
            onOutdent(issue);
          }
        }}
        className={`min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm focus:bg-card focus:outline-none focus:ring-1 focus:ring-line ${
          done ? "text-ink-faint line-through" : "text-ink"
        }`}
      />
      {/* Arc assignment stays a hover/focus affordance — desktop-only polish,
          not a navigation control. */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        {depth === 0 && <ArcMenu issue={issue} arcs={arcs} />}
      </div>
    </div>
  );
}

// ---------- sortable subtree block ----------

// One node of the forest as a sortable item (PROG-86). The whole SUBTREE (row +
// its descendants + the roving capture slot) is the sortable element, so
// dragging a parent visually carries its children as a block. The activator is
// the grip inside IssueRow, so only the handle starts a drag — the title input
// and the ⋯ open-link keep working normally. Reorder is constrained to siblings
// on drop (see ProductOutline.onDragEnd); reparenting stays on Tab/Shift+Tab.
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
  onIndent: (issue: WireIssue) => void;
  onOutdent: (issue: WireIssue) => void;
  renderForest: (forest: Node[]) => ReactNode;
  renderCapture: (node: Node) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.issue.id });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "relative z-10 opacity-80" : undefined}>
      <IssueRow
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

// ---------- product capture (initiative scope only) ----------

// An initiative's first issue needs a product to live on, and a product needs a
// permanent, unique issue-key prefix (e.g. PROG). So unlike issues/arcs, a
// product can't be a bare "type a name" bullet — but we keep the Workflowy feel:
// type the name → the prefix auto-fills (editable) → Enter. The prefix is
// deduped against every existing product client-side so Enter never hits a 409.
const suggestPrefix = (name: string) =>
  name
    .toUpperCase()
    .replaceAll(/[^A-Z]/g, "")
    .slice(0, 4);

function ProductCaptureRow({
  initiativeId,
  existingPrefixes,
  focusToken,
  onCreated,
}: {
  initiativeId: string;
  existingPrefixes: Set<string>;
  focusToken: number;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [prefixTouched, setPrefixTouched] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // Refocus the name field after each create so products capture continuously.
  useEffect(() => {
    if (focusToken > 0) nameRef.current?.focus();
  }, [focusToken]);

  const norm = prefix.toUpperCase();
  const prefixValid = /^[A-Z]{2,8}$/.test(norm);
  const clash = prefixValid && existingPrefixes.has(norm);
  const canSubmit = name.trim() !== "" && prefixValid && !clash;

  const submit = () => {
    if (!canSubmit) return;
    createContainer({ kind: "product", name: name.trim(), initiativeId, keyPrefix: norm });
    setName("");
    setPrefix("");
    setPrefixTouched(false);
    onCreated();
  };

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      {/* Match IssueRow's drag-grip + open-link gutters so bullets align
          (PROG-80/PROG-86). */}
      <span className="h-6 w-5 shrink-0" aria-hidden />
      <span className="h-6 w-6 shrink-0" aria-hidden />
      <LevelIcon kind="product" />
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
        placeholder="New product — Enter to add"
        className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm text-ink placeholder:text-ink-faint focus:bg-card focus:outline-none focus:ring-1 focus:ring-line"
      />
      <input
        value={prefix}
        onChange={(e) => {
          setPrefixTouched(true);
          setPrefix(e.target.value.toUpperCase().replaceAll(/[^A-Z]/g, "").slice(0, 8));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="KEY"
        title="Issue-key prefix: 2–8 letters, unique across products"
        className={`w-16 shrink-0 rounded bg-transparent px-1 py-0.5 text-center font-mono text-[11px] uppercase focus:bg-card focus:outline-none focus:ring-1 ${
          clash ? "text-adobe-deep ring-1 ring-adobe" : "text-ink-faint focus:ring-line"
        }`}
      />
      {clash && <span className="shrink-0 text-[11px] text-adobe-deep">in use</span>}
    </div>
  );
}

// ---------- the capture (roving new-bullet) input ----------

function CaptureRow({
  depth,
  placeholder,
  onCreate,
  onDeepen,
  onShallow,
  focusToken,
}: {
  depth: number;
  placeholder: string;
  onCreate: (title: string) => void;
  onDeepen: () => void;
  onShallow: () => void;
  focusToken: number;
}) {
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  // Refocus after each create (focusToken bumps) so capture stays continuous.
  useEffect(() => {
    if (focusToken > 0) ref.current?.focus();
  }, [focusToken]);

  return (
    <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: depth * 22 }}>
      {/* Empty gutters matching IssueRow's drag grip + far-left open-link so the
          ＋ bullet lines up with the issue bullets above it (PROG-80/PROG-86). */}
      <span className="h-6 w-5 shrink-0" aria-hidden />
      <span className="h-6 w-6 shrink-0" aria-hidden />
      <span className="text-ink-faint/50">＋</span>
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const t = draft.trim();
            if (t) {
              onCreate(t);
              setDraft("");
            }
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

// ---------- one product's outline (forest + capture) ----------

function ProductOutline({
  product,
  ws,
  showHeader,
  hideDone,
  grip,
}: {
  product: WireProduct;
  ws: SnapshotPayload;
  showHeader: boolean;
  hideDone: boolean;
  // At initiative scope the whole section is sortable (PROG-87); the enclosing
  // SortableSection hands its drag grip down to render in the header.
  grip?: ReactNode;
}) {
  const issues = ws.issues;
  const arcs = ws.arcs;
  // What the forest renders. When "hide done" is on, completed (done/canceled)
  // issues — and their subtrees, since a hidden parent never recurses — drop out
  // entirely (PROG-77). Capture/indent helpers keep working off the full
  // `issues` list so nesting math is unaffected by what's currently visible.
  const visibleIssues = useMemo(
    () => (hideDone ? issues.filter((i) => isOpenStatus(i.status)) : issues),
    [issues, hideDone],
  );
  // The roving capture target: which issue the next new bullet nests under
  // (null = product top level, no arc). `captureArc` scopes a top-level new
  // bullet to an arc section. Re-validated against live data each render.
  const [captureParent, setCaptureParent] = useState<string | null>(null);
  const [captureArc, setCaptureArc] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);

  // Rendered arc order: manual rank first, name tiebreak — so a product whose
  // arcs nobody has dragged lists them alphabetically (PROG-87).
  const productArcs = useMemo(
    () => arcs.filter((a) => a.productId === product.id && !a.archivedAt).sort(byRankThenName),
    [arcs, product.id],
  );

  // Top-level (no-arc) forest, and one forest per arc.
  const looseForest = useMemo(
    () => buildForest(visibleIssues, product.id, null, null, 0),
    [visibleIssues, product.id],
  );
  const arcForests = useMemo(
    () => productArcs.map((a) => ({ arc: a, forest: buildForest(visibleIssues, product.id, null, a.id, 1) })),
    [visibleIssues, product.id, productArcs],
  );

  const issueById = useMemo(() => {
    const m = new Map<string, WireIssue>();
    for (const i of issues) m.set(i.id, i);
    return m;
  }, [issues]);

  // Indent an existing issue: nest it under its nearest preceding sibling.
  const indent = (issue: WireIssue) => {
    const siblings = issues
      .filter(
        (i) =>
          i.productId === issue.productId &&
          i.parentIssueId === issue.parentIssueId &&
          (issue.parentIssueId === null ? i.arcId === issue.arcId : true),
      )
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.number - b.number));
    const idx = siblings.findIndex((i) => i.id === issue.id);
    const prev = siblings[idx - 1];
    if (!prev) return; // nothing to nest under
    void updateIssue(issue.id, { parentIssueId: prev.id, arcId: prev.arcId });
  };

  // Outdent an existing issue: hop up to its grandparent (or to top level).
  const outdent = (issue: WireIssue) => {
    if (issue.parentIssueId === null) return; // already at the ceiling
    const parent = issueById.get(issue.parentIssueId);
    if (!parent) return;
    void updateIssue(issue.id, {
      parentIssueId: parent.parentIssueId,
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
    if (productArcs.some((a) => a.id === id)) setActiveArcId(id);
  };

  // The visible sibling group an issue belongs to, in rendered (rank) order —
  // exactly the set a drag is allowed to reorder within.
  const siblingGroup = (issue: WireIssue): WireIssue[] =>
    visibleIssues
      .filter(
        (i) =>
          i.productId === issue.productId &&
          i.parentIssueId === issue.parentIssueId &&
          (issue.parentIssueId === null ? i.arcId === issue.arcId : true),
      )
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.number - b.number));

  const onReorder = (e: DragEndEvent) => {
    setActiveArcId(null);
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || overId === activeId) return;

    // Arc sections share this DndContext with the issue rows inside them
    // (PROG-87) — branch on what is actually being dragged.
    if (productArcs.some((a) => a.id === activeId)) {
      // Resolve the drop target to an arc: with closestCenter the `over` is
      // often a row inside a neighbouring arc's section rather than its header.
      const overArcId = productArcs.some((a) => a.id === overId)
        ? overId
        : (issueById.get(overId)?.arcId ?? null);
      if (!overArcId || overArcId === activeId) return;
      // One write once ranks are distinct; the first drag in a still-tied
      // (alphabetical) group renumbers the whole group — see containerReorder.
      const updates = containerReorderRanks(productArcs, activeId, overArcId);
      for (const u of updates ?? []) void updateContainer("arc", u.id, { rank: u.rank });
      return;
    }

    const active = issueById.get(activeId);
    const over = issueById.get(overId);
    if (!active || !over) return;
    // Reorder only within one sibling group; a drop onto a row in another group
    // (a different parent/arc) is a no-op — reparenting stays on Tab/Shift+Tab,
    // matching the board's rank-only semantics (the issue asks for up/down only).
    const sameGroup =
      active.productId === over.productId &&
      active.parentIssueId === over.parentIssueId &&
      (active.parentIssueId !== null || active.arcId === over.arcId);
    if (!sameGroup) return;
    const group = siblingGroup(active);
    const newRank = rankForReorder(
      group.map((i) => i.id),
      (id) => issueById.get(id)!.rank,
      activeId,
      overId,
    );
    // Same shared `rank` the board writes — so this drag also moves the card on
    // the board, and a board drag moves the row here (PROG-86).
    if (newRank) void updateIssue(activeId, { rank: newRank });
  };

  // Capture-input deepen/shallow: move the new-bullet target down/up a level by
  // pointing it at the last issue of the current sibling group.
  const lastSiblingOf = (parentId: string | null, arcId: string | null): WireIssue | undefined => {
    const sibs = issues
      .filter(
        (i) =>
          i.productId === product.id &&
          i.parentIssueId === parentId &&
          (parentId === null ? i.arcId === arcId : true),
      )
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.number - b.number));
    return sibs[sibs.length - 1];
  };
  const deepen = () => {
    const last = lastSiblingOf(captureParent, captureArc);
    if (last) {
      setCaptureParent(last.id);
      setCaptureArc(last.arcId);
    }
  };
  const shallow = () => {
    if (captureParent === null) return;
    const parent = issueById.get(captureParent);
    setCaptureParent(parent ? parent.parentIssueId : null);
    if (parent && parent.parentIssueId === null) setCaptureArc(parent.arcId);
  };

  const create = (title: string, parentIssueId: string | null, arcId: string | null) => {
    createIssue({
      title,
      productId: product.id,
      repoId: null,
      arcId,
      parentIssueId,
      status: "todo",
      priority: "none",
      estimate: null,
      dueDate: null,
    });
    setFocusToken((t) => t + 1);
  };

  // The roving capture input, dropped after the subtree of whichever issue the
  // capture currently targets.
  const renderCapture = (node: Node) =>
    captureParent === node.issue.id ? (
      <CaptureRow
        depth={node.depth + 1}
        placeholder="New sub-issue — Enter to add, Shift+Tab to outdent"
        onCreate={(t) => create(t, node.issue.id, node.issue.arcId)}
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
      <SortableContext items={forest.map((n) => n.issue.id)} strategy={verticalListSortingStrategy}>
        {forest.map((node) => (
          <OutlineNode
            key={node.issue.id}
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

  const captureDepthForArc = captureParent === null;

  return (
    <section className={showHeader ? "rounded-lg border border-line bg-card p-3" : ""}>
      {showHeader && (
        <div className="group mb-1 flex items-center gap-2">
          {grip}
          <LevelIcon kind="product" />
          <Link href={`/product/${product.id}`} className="font-medium text-ink hover:underline">
            {product.name}
          </Link>
          <span className="font-mono text-[11px] text-ink-faint">{product.keyPrefix}</span>
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
      {/* Product-level (no-arc) issues + their roving capture row. */}
      {renderForest(looseForest)}
      {captureParent === null && captureArc === null && (
        <CaptureRow
          depth={0}
          placeholder="New issue — Enter to add, Tab to nest under the one above"
          onCreate={(t) => create(t, null, null)}
          onDeepen={deepen}
          onShallow={shallow}
          focusToken={focusToken}
        />
      )}

      {/* Arc sections — themselves drag-to-reorderable as whole blocks via the
          grip in their header (PROG-87), inside the same DndContext as the
          issue rows (onReorder branches on what's dragged). */}
      <SortableContext items={arcForests.map(({ arc }) => arc.id)} strategy={verticalListSortingStrategy}>
      {arcForests.map(({ arc, forest }) => (
        <SortableSection key={arc.id} id={arc.id} label={`Reorder ${arc.name}`} className="mt-2">
          {(arcGrip) => (
            <>
          <div className="group flex items-center gap-1.5" style={{ paddingLeft: 0 }}>
            {arcGrip}
            <LevelIcon kind="arc" />
            <Link href={`/arc/${arc.id}`} className="text-sm font-medium text-moss-deep hover:underline">
              {arc.name}
            </Link>
          </div>
          {renderForest(forest)}
          {captureParent === null && captureArc === arc.id && (
            <CaptureRow
              depth={1}
              placeholder={`New issue in ${arc.name}`}
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
              style={{ marginLeft: 22 }}
            >
              + issue here
            </button>
          )}
            </>
          )}
        </SortableSection>
      ))}
      </SortableContext>

      {/* When capture has roved off the top level, offer a way back. */}
      {!captureDepthForArc && (
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
          const held = activeArcId ? arcForests.find(({ arc }) => arc.id === activeArcId) : undefined;
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

type Root = { kind: "product"; id: string } | { kind: "initiative"; id: string };

export default function Outline({ snapshot }: { snapshot: SnapshotPayload }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const [productFocus, setProductFocus] = useState(0);

  // "Hide done" is a sticky per-user view preference (PROG-77): seed from
  // localStorage on mount, mirror back on every change so it survives navigating
  // away and returning.
  const [hideDone, setHideDone] = useState(loadHideDone);
  useEffect(() => saveHideDone(hideDone), [hideDone]);

  // Every product's prefix, for client-side dedupe of new-product keys.
  const existingPrefixes = useMemo(
    () => new Set(snapshot.products.map((p) => p.keyPrefix.toUpperCase())),
    [snapshot.products],
  );

  // Manual rank first, name tiebreak (PROG-87) — alphabetical until the owner
  // starts dragging sections around, then the dragged order wins everywhere.
  const products = useMemo(
    () => [...snapshot.products].filter((p) => !p.archivedAt).sort(byRankThenName),
    [snapshot.products],
  );
  const initiatives = useMemo(
    () => [...snapshot.initiatives].filter((i) => !i.archivedAt).sort(byRankThenName),
    [snapshot.initiatives],
  );

  // Resolve the active root: URL params win (links stay shareable), then the
  // sticky last-used scope (localStorage — so navigating away and back lands on
  // the same scope), then the first product. Every id is validated against
  // live data so a stale saved scope falls through instead of blanking the view.
  const root: Root | null = useMemo(() => {
    const prd = params.get("product");
    const ini = params.get("initiative");
    if (prd && products.some((p) => p.id === prd)) return { kind: "product", id: prd };
    if (ini && initiatives.some((i) => i.id === ini)) return { kind: "initiative", id: ini };
    const saved = loadScope();
    if (saved?.kind === "product" && products.some((p) => p.id === saved.id)) return saved;
    if (saved?.kind === "initiative" && initiatives.some((i) => i.id === saved.id)) return saved;
    if (products[0]) return { kind: "product", id: products[0].id };
    if (initiatives[0]) return { kind: "initiative", id: initiatives[0].id };
    return null;
  }, [search, products, initiatives]);

  // Mirror the resolved scope back to storage on every change — picking from
  // the dropdown, following a scoped link, or the fallback itself.
  useEffect(() => {
    if (root) saveScope(root);
  }, [root?.kind, root?.id]);

  const setRoot = (value: string) => {
    const [kind, id] = value.split(":");
    navigate(`/outline?${kind}=${id}`);
  };

  const scopedProducts =
    root?.kind === "product"
      ? products.filter((p) => p.id === root.id)
      : root?.kind === "initiative"
        ? products.filter((p) => p.initiativeId === root.id)
        : [];

  // At initiative scope the product sections are drag-to-reorderable (PROG-87).
  // This outer DndContext nests around each ProductOutline's own context; the
  // product grip is the only activator registered here, so arc/issue drags
  // inside a section never reach this handler.
  const productSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const onProductReorder = (e: DragEndEvent) => {
    setActiveProductId(null);
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || overId === activeId) return;
    const updates = containerReorderRanks(scopedProducts, activeId, overId);
    for (const u of updates ?? []) void updateContainer("product", u.id, { rank: u.rank });
  };

  // Overlay preview for a held product section: its arcs as rows (the level a
  // product grouping is made of), matching the arc previews' capped card.
  const heldProduct = activeProductId ? scopedProducts.find((p) => p.id === activeProductId) : undefined;
  const heldProductRows = heldProduct
    ? [...snapshot.arcs]
        .filter((a) => a.productId === heldProduct.id && !a.archivedAt)
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
            Fast capture — type to add issues, <kbd>Enter</kbd> for the next,{" "}
            <kbd>Tab</kbd>/<kbd>Shift+Tab</kbd> to nest. Tap the <code>⋯</code> at the
            start of a row to open the full issue.
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
              <optgroup label="Products">
                {products.map((p) => (
                  <option key={p.id} value={`product:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Initiatives">
                {initiatives.map((i) => (
                  <option key={i.id} value={`initiative:${i.id}`}>
                    {i.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {!root && <p className="text-sm text-ink-faint">No products or initiatives yet.</p>}

        {root?.kind === "initiative" ? (
          <DndContext
            sensors={productSensors}
            collisionDetection={closestCenter}
            onDragStart={(e: DragStartEvent) => setActiveProductId(String(e.active.id))}
            onDragEnd={onProductReorder}
            onDragCancel={() => setActiveProductId(null)}
          >
            <SortableContext items={scopedProducts.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              {/* Pointer-inert while a product section is held — see the arc
                  drag's identical wrapper (PROG-87 polish). */}
              <div className={`space-y-4 ${activeProductId ? "pointer-events-none select-none" : ""}`}>
                {scopedProducts.map((p) => (
                  <SortableSection key={p.id} id={p.id} label={`Reorder ${p.name}`}>
                    {(productGrip) => (
                      <ProductOutline
                        product={p}
                        ws={snapshot}
                        showHeader
                        hideDone={hideDone}
                        grip={productGrip}
                      />
                    )}
                  </SortableSection>
                ))}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {heldProduct && (
                <SectionPreviewCard
                  header={
                    <>
                      <LevelIcon kind="product" />
                      <span className="font-medium text-ink">{heldProduct.name}</span>
                      <span className="font-mono text-[11px] text-ink-faint">{heldProduct.keyPrefix}</span>
                    </>
                  }
                  rows={heldProductRows}
                  more={heldProductRows.length - PREVIEW_ROWS}
                />
              )}
            </DragOverlay>
          </DndContext>
        ) : (
          scopedProducts.map((p) => (
            <ProductOutline key={p.id} product={p} ws={snapshot} showHeader={false} hideDone={hideDone} />
          ))
        )}

        {/* At initiative scope, products are the top ceiling — so offer inline
            product capture (and seed the empty state). Product scope has no
            level above the arc/issue ceiling, so it shows nothing here. */}
        {root?.kind === "initiative" && (
          <section className="rounded-lg border border-dashed border-line bg-card/40 p-3">
            {scopedProducts.length === 0 && (
              <p className="mb-1 text-sm text-ink-faint">
                No products yet — add the first one to start capturing.
              </p>
            )}
            <ProductCaptureRow
              initiativeId={root.id}
              existingPrefixes={existingPrefixes}
              focusToken={productFocus}
              onCreated={() => setProductFocus((t) => t + 1)}
            />
          </section>
        )}
      </div>
    </div>
  );
}
