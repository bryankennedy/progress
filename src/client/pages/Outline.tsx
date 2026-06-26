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
// archives — the `…` opens the full issue page.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import type { WireArc, WireIssue, WireProduct } from "../../shared/types";
import type { WorkspacePayload } from "../../shared/types";
import {
  createContainer,
  createIssue,
  issueKeyOf,
  updateIssue,
} from "../store";

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
}: {
  node: Node;
  ws: WorkspacePayload;
  arcs: WireArc[];
  onIndent: (issue: WireIssue) => void;
  onOutdent: (issue: WireIssue) => void;
}) {
  const { issue, depth } = node;
  const [draft, setDraft] = useState(issue.title);
  // Keep the input in sync if the title changes elsewhere (e.g. server reconcile)
  // while this row isn't focused.
  useEffect(() => setDraft(issue.title), [issue.title]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== issue.title) void updateIssue(issue.id, { title: next });
    else if (!next) setDraft(issue.title); // never blank a saved issue
  };

  return (
    <div
      className="group flex items-center gap-1.5 rounded py-0.5 hover:bg-line/30"
      style={{ paddingLeft: depth * 22 }}
    >
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
        className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm text-ink focus:bg-card focus:outline-none focus:ring-1 focus:ring-line"
      />
      {/* Affordances appear on hover/focus to keep the outline clean. */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        {depth === 0 && <ArcMenu issue={issue} arcs={arcs} />}
        <Link
          href={`/issue/${issueKeyOf(ws, issue)}`}
          title="Open full issue"
          className="rounded px-1 text-ink-faint hover:bg-line hover:text-ink-soft"
        >
          …
        </Link>
      </div>
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
}: {
  product: WireProduct;
  ws: WorkspacePayload;
  showHeader: boolean;
}) {
  const issues = ws.issues;
  const arcs = ws.arcs;
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
    () => buildForest(issues, product.id, null, null, 0),
    [issues, product.id],
  );
  const arcForests = useMemo(
    () => productArcs.map((a) => ({ arc: a, forest: buildForest(issues, product.id, null, a.id, 1) })),
    [issues, product.id, productArcs],
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

  // Render a forest of issue rows, dropping the roving capture input after the
  // subtree of whichever issue the capture currently targets.
  const renderForest = (forest: Node[]) =>
    forest.map((node) => (
      <div key={node.issue.id}>
        <IssueRow node={node} ws={ws} arcs={arcs} onIndent={indent} onOutdent={outdent} />
        {renderForest(node.children)}
        {captureParent === node.issue.id && (
          <CaptureRow
            depth={node.depth + 1}
            placeholder="New sub-issue — Enter to add, Shift+Tab to outdent"
            onCreate={(t) => create(t, node.issue.id, node.issue.arcId)}
            onDeepen={deepen}
            onShallow={shallow}
            focusToken={focusToken}
          />
        )}
      </div>
    ));

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
    </section>
  );
}

// ---------- root picker + page ----------

type Root = { kind: "product"; id: string } | { kind: "initiative"; id: string };

export default function Outline({ workspace }: { workspace: WorkspacePayload }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);

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
            <kbd>Tab</kbd>/<kbd>Shift+Tab</kbd> to nest. The <code>…</code> opens the full issue.
          </p>
        </div>
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

      <div className="mt-5 space-y-4">
        {!root && <p className="text-sm text-ink-faint">No products or initiatives yet.</p>}
        {scopedProducts.length === 0 && root && (
          <p className="text-sm text-ink-faint">This initiative has no products yet.</p>
        )}
        {scopedProducts.map((p) => (
          <ProductOutline
            key={p.id}
            product={p}
            ws={workspace}
            showHeader={root?.kind === "initiative"}
          />
        ))}
      </div>
    </div>
  );
}
