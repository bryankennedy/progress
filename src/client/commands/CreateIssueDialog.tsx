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
import { createIssue, findIssueByKey } from "../store";
import { onOpenCreateIssue, type CreateDefaults } from "./controller";

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
  const [path, navigate] = useLocation();
  const search = useSearch();

  useEffect(
    () =>
      onOpenCreateIssue((given) => {
        const defaults = { ...deriveDefaults(workspace, path, search), ...given };
        if (!defaults.productId) defaults.productId = workspace.products[0]?.id;
        setContainer(containerValue(defaults));
        setArcId(defaults.arcId ?? "");
        setTitle("");
        setStatus("todo");
        setPriority("none");
        setEstimate("");
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

  const productArcs = workspace.arcs.filter((a) => a.productId === selectedProductId);

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
    });
    setOpen(false);
    if (key) navigate(`/issue/${key}`);
  };

  const selectClass =
    "rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-600 hover:border-stone-400";

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/20 p-4" onMouseDown={() => setOpen(false)}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mx-auto mt-[12vh] max-w-lg rounded-xl border border-stone-200 bg-white p-4 shadow-2xl"
      >
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400">New issue</h2>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Issue title"
          className="mt-2 w-full rounded border border-stone-200 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <select value={container} onChange={(e) => onContainerChange(e.target.value)} className={selectClass}>
            {workspace.products.map((p) => {
              const productRepos = workspace.repos.filter((r) => r.productId === p.id);
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
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded px-3 py-1 text-sm text-stone-500 hover:bg-stone-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={title.trim() === "" || !selectedProductId}
            className="rounded bg-stone-900 px-3 py-1 text-sm text-white hover:bg-stone-700 disabled:opacity-40"
          >
            Create issue
          </button>
        </div>
      </form>
    </div>
  );
}
