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
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { WireArc, WireIssue, WireProduct } from "../../shared/types";
import type { WorkspacePayload } from "../../shared/types";
import { isOpenStatus } from "../../shared/constants";
import {
  createContainer,
  createIssue,
  issueKeyOf,
  updateIssue,
} from "../store";
import { rankForReorder } from "../outlineReorder";
import { loadHideDone, saveHideDone } from "../outlinePrefs";

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
  ws: WorkspacePayload;
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
      {/* Drag handle (PROG-86). touch-none so a drag from the grip reorders
          instead of scrolling the page; always shown on mobile (no hover), faint
          until row hover/focus on desktop to keep the outline calm. */}
      <button
        ref={handleRef}
        {...handleProps}
        type="button"
        aria-label={`Reorder ${issueKey}`}
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
  ws: WorkspacePayload;
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
}: {
  product: WireProduct;
  ws: WorkspacePayload;
  showHeader: boolean;
  hideDone: boolean;
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

  const productArcs = useMemo(
    () => arcs.filter((a) => a.productId === product.id && !a.archivedAt),
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
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || overId === activeId) return;
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
        <div className="mb-1 flex items-center gap-2">
          <LevelIcon kind="product" />
          <Link href={`/product/${product.id}`} className="font-medium text-ink hover:underline">
            {product.name}
          </Link>
          <span className="font-mono text-[11px] text-ink-faint">{product.keyPrefix}</span>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
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

      {/* Arc sections. */}
      {arcForests.map(({ arc, forest }) => (
        <div key={arc.id} className="mt-2">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: 0 }}>
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
        </div>
      ))}

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
      </DndContext>
    </section>
  );
}

// ---------- root picker + page ----------

type Root = { kind: "product"; id: string } | { kind: "initiative"; id: string };

export default function Outline({ workspace }: { workspace: WorkspacePayload }) {
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
    () => new Set(workspace.products.map((p) => p.keyPrefix.toUpperCase())),
    [workspace.products],
  );

  const products = useMemo(
    () => [...workspace.products].filter((p) => !p.archivedAt).sort((a, b) => a.name.localeCompare(b.name)),
    [workspace.products],
  );
  const initiatives = useMemo(
    () => [...workspace.initiatives].filter((i) => !i.archivedAt).sort((a, b) => a.name.localeCompare(b.name)),
    [workspace.initiatives],
  );

  // Resolve the active root from the URL, falling back to the first product.
  const root: Root | null = useMemo(() => {
    const prd = params.get("product");
    const ini = params.get("initiative");
    if (prd && products.some((p) => p.id === prd)) return { kind: "product", id: prd };
    if (ini && initiatives.some((i) => i.id === ini)) return { kind: "initiative", id: ini };
    if (products[0]) return { kind: "product", id: products[0].id };
    if (initiatives[0]) return { kind: "initiative", id: initiatives[0].id };
    return null;
  }, [search, products, initiatives]);

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

        {scopedProducts.map((p) => (
          <ProductOutline
            key={p.id}
            product={p}
            ws={workspace}
            showHeader={root?.kind === "initiative"}
            hideDone={hideDone}
          />
        ))}

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
