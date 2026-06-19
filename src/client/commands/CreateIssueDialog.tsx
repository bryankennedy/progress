// Issue creation (SPEC §4: "create an issue from anywhere"). The container
// defaults to wherever the user currently is — the open container page, the
// viewed issue's container, or the board's active filters — so the common
// case is: press C, type a title, hit Enter.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ISSUE_ESTIMATES,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssuePriority,
  type IssueStatus,
} from "../../shared/constants";
import type { WorkspacePayload } from "../../shared/types";
import { PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import { createContainer, createIssue, findIssueByKey } from "../store";
import { onOpenCreateIssue, type CreateDefaults } from "./controller";

// e.g. "My Side Project" → "MYSI"; the user can override.
const suggestPrefix = (name: string) =>
  name.toUpperCase().replaceAll(/[^A-Z]/g, "").slice(0, 4);

// The container <select> encodes "product-level or repo" in one value.
const containerValue = (d: CreateDefaults) =>
  d.repoId ? `r:${d.repoId}` : d.productId ? `p:${d.productId}` : "";

function deriveDefaults(ws: WorkspacePayload, path: string, search: string): CreateDefaults {
  let m = /^\/product\/([^/]+)/.exec(path);
  if (m) return { productId: m[1] };
  m = /^\/repo\/([^/]+)/.exec(path);
  if (m) {
    const repo = ws.repos.find((r) => r.id === m![1]);
    if (repo) return { productId: repo.productId, repoId: repo.id };
  }
  m = /^\/arc\/([^/]+)/.exec(path);
  if (m) {
    const arc = ws.arcs.find((a) => a.id === m![1]);
    if (arc) return { productId: arc.productId, arcId: arc.id };
  }
  m = /^\/issue\/([^/]+)/.exec(path);
  if (m) {
    const found = findIssueByKey(ws, decodeURIComponent(m[1]!));
    if (found) return { productId: found.issue.productId, repoId: found.issue.repoId };
  }
  // The board: honor its active container filters.
  const params = new URLSearchParams(search);
  const repo = ws.repos.find((r) => r.id === params.get("repo"));
  if (repo) return { productId: repo.productId, repoId: repo.id };
  const arc = ws.arcs.find((a) => a.id === params.get("arc"));
  if (arc) return { productId: arc.productId, arcId: arc.id };
  const product = ws.products.find((p) => p.id === params.get("product"));
  if (product) return { productId: product.id };
  return {};
}

export default function CreateIssueDialog({ workspace }: { workspace: WorkspacePayload }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [container, setContainer] = useState("");
  const [arcId, setArcId] = useState("");
  const [status, setStatus] = useState<IssueStatus>("todo");
  const [priority, setPriority] = useState<IssuePriority>("none");
  const [estimate, setEstimate] = useState("");
  const [dueDate, setDueDate] = useState("");
  // Inline structure creation (SPEC v2 §4): spin up a product or arc without
  // leaving the dialog; the new container is created optimistically and
  // selected in place. `null` = panel closed.
  const [newProduct, setNewProduct] = useState<{ name: string; prefix: string; initiativeId: string } | null>(null);
  const [newArc, setNewArc] = useState<string | null>(null);
  const [path, navigate] = useLocation();
  const search = useSearch();

  useEffect(
    () =>
      onOpenCreateIssue((given) => {
        const defaults = { ...deriveDefaults(workspace, path, search), ...given };
        if (!defaults.productId)
          defaults.productId = workspace.products.find((p) => !p.archivedAt)?.id;
        setContainer(containerValue(defaults));
        setArcId(defaults.arcId ?? "");
        setTitle("");
        setStatus("todo");
        setPriority("none");
        setEstimate("");
        setDueDate("");
        setNewProduct(null);
        setNewArc(null);
        setOpen(true);
      }),
    [workspace, path, search],
  );

  const selectedProductId = useMemo(() => {
    if (container.startsWith("p:")) return container.slice(2);
    if (container.startsWith("r:"))
      return workspace.repos.find((r) => r.id === container.slice(2))?.productId;
    return undefined;
  }, [container, workspace.repos]);

  // Archived containers aren't valid creation targets (D26).
  const activeProducts = workspace.products.filter((p) => !p.archivedAt);
  const activeInitiatives = workspace.initiatives.filter((i) => !i.archivedAt);
  const productArcs = workspace.arcs.filter(
    (a) => a.productId === selectedProductId && !a.archivedAt,
  );

  const submitNewProduct = () => {
    if (!newProduct) return;
    const name = newProduct.name.trim();
    if (name === "" || !/^[A-Z]{2,8}$/.test(newProduct.prefix) || !newProduct.initiativeId) return;
    const id = createContainer({
      kind: "product",
      name,
      initiativeId: newProduct.initiativeId,
      keyPrefix: newProduct.prefix,
    });
    setContainer(`p:${id}`);
    setArcId("");
    setNewProduct(null);
  };

  const submitNewArc = () => {
    if (newArc === null || newArc.trim() === "" || !selectedProductId) return;
    const id = createContainer({ kind: "arc", name: newArc.trim(), productId: selectedProductId });
    setArcId(id);
    setNewArc(null);
  };

  if (!open) return null;

  const onContainerChange = (value: string) => {
    setContainer(value);
    const productId = value.startsWith("p:")
      ? value.slice(2)
      : workspace.repos.find((r) => r.id === value.slice(2))?.productId;
    // Arc must stay within the issue's product (SPEC §3).
    setArcId((a) => (workspace.arcs.find((x) => x.id === a)?.productId === productId ? a : ""));
  };

  const submit = () => {
    const trimmed = title.trim();
    if (trimmed === "" || !selectedProductId) return;
    const key = createIssue({
      title: trimmed,
      productId: selectedProductId,
      repoId: container.startsWith("r:") ? container.slice(2) : null,
      arcId: arcId || null,
      status,
      priority,
      estimate: estimate === "" ? null : Number(estimate),
      dueDate: dueDate || null,
    });
    setOpen(false);
    if (key) navigate(`/issue/${key}`);
  };

  const selectClass =
    "rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft hover:border-ink-faint";

  return (
    <div className="fixed inset-0 z-50 bg-ink/20 p-4" onMouseDown={() => setOpen(false)}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mx-auto mt-[12vh] max-w-lg rounded-xl border border-line bg-card p-4 shadow-2xl"
      >
        <h2 className="text-xs font-medium uppercase tracking-wide font-mono text-ink-faint">New issue</h2>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Issue title"
          className="mt-2 w-full rounded border border-line px-3 py-2 text-sm focus:border-ink-faint focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <select value={container} onChange={(e) => onContainerChange(e.target.value)} className={selectClass}>
            {activeProducts.map((p) => {
              const productRepos = workspace.repos.filter(
                (r) => r.productId === p.id && !r.archivedAt,
              );
              return (
                <optgroup key={p.id} label={p.name}>
                  <option value={`p:${p.id}`}>{p.name}</option>
                  {productRepos.map((r) => (
                    <option key={r.id} value={`r:${r.id}`}>
                      {p.name} / {r.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <button
            type="button"
            onClick={() =>
              setNewProduct((p) =>
                p ? null : { name: "", prefix: "", initiativeId: activeInitiatives[0]?.id ?? "" },
              )
            }
            className={selectClass}
          >
            + New product
          </button>
          {productArcs.length > 0 && (
            <select value={arcId} onChange={(e) => setArcId(e.target.value)} className={selectClass}>
              <option value="">No arc</option>
              {productArcs.map((a) => (
                <option key={a.id} value={a.id}>
                  Arc: {a.name}
                </option>
              ))}
            </select>
          )}
          {selectedProductId && (
            <button
              type="button"
              onClick={() => setNewArc((a) => (a === null ? "" : null))}
              className={selectClass}
            >
              + New arc
            </button>
          )}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as IssueStatus)}
            className={selectClass}
          >
            {ISSUE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as IssuePriority)}
            className={selectClass}
          >
            {ISSUE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          <select value={estimate} onChange={(e) => setEstimate(e.target.value)} className={selectClass}>
            <option value="">No estimate</option>
            {ISSUE_ESTIMATES.map((e) => (
              <option key={e} value={String(e)}>
                {e} pts
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            title="Due date (optional)"
            className={selectClass}
          />
        </div>

        {/* Inline product create (SPEC v2 §4): name + key prefix + initiative,
            created and selected without leaving the dialog. */}
        {newProduct && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-line bg-paper p-2">
            <input
              autoFocus
              value={newProduct.name}
              onChange={(e) =>
                setNewProduct((p) =>
                  p ? { ...p, name: e.target.value, prefix: p.prefix || suggestPrefix(e.target.value) } : p,
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitNewProduct();
                }
              }}
              placeholder="Product name"
              className="min-w-40 flex-1 rounded border border-line px-2 py-1 text-xs focus:border-ink-faint focus:outline-none"
            />
            <input
              value={newProduct.prefix}
              onChange={(e) =>
                setNewProduct((p) =>
                  p ? { ...p, prefix: e.target.value.toUpperCase().replaceAll(/[^A-Z]/g, "").slice(0, 8) } : p,
                )
              }
              placeholder="KEY"
              title="Issue-key prefix: 2–8 letters"
              className="w-20 rounded border border-line px-2 py-1 font-mono text-xs uppercase focus:border-ink-faint focus:outline-none"
            />
            <select
              value={newProduct.initiativeId}
              onChange={(e) => setNewProduct((p) => (p ? { ...p, initiativeId: e.target.value } : p))}
              className={selectClass}
            >
              {activeInitiatives.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={submitNewProduct}
              disabled={newProduct.name.trim() === "" || !/^[A-Z]{2,8}$/.test(newProduct.prefix) || !newProduct.initiativeId}
              className="rounded bg-adobe px-2 py-1 text-xs text-white hover:bg-adobe-deep disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}

        {/* Inline arc create (SPEC v2 §4): a name within the selected product. */}
        {newArc !== null && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-line bg-paper p-2">
            <input
              autoFocus
              value={newArc}
              onChange={(e) => setNewArc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitNewArc();
                }
              }}
              placeholder="Arc name"
              className="min-w-40 flex-1 rounded border border-line px-2 py-1 text-xs focus:border-ink-faint focus:outline-none"
            />
            <button
              type="button"
              onClick={submitNewArc}
              disabled={newArc.trim() === "" || !selectedProductId}
              className="rounded bg-adobe px-2 py-1 text-xs text-white hover:bg-adobe-deep disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded px-3 py-1 text-sm text-ink-soft hover:bg-line"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={title.trim() === "" || !selectedProductId}
            className="rounded bg-adobe px-3 py-1 text-sm text-white hover:bg-adobe-deep disabled:opacity-40"
          >
            Create issue
          </button>
        </div>
      </form>
    </div>
  );
}
