// Container creation (D26): one dialog for all four types, opened from
// palette commands or the "+ New" buttons on container pages. Creation is
// optimistic with a client-generated id, so submit navigates to the new
// container page instantly.

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { WorkspacePayload } from "../../shared/types";
import { createContainer, findIssueByKey, type ContainerCreateInput } from "../store";
import { onOpenCreateContainer, type ContainerDialogRequest } from "./controller";

const KIND_LABELS = { initiative: "initiative", product: "product", repo: "repo", arc: "arc" };

// e.g. "My Side Project" → "MYSI"; the user can always override.
const suggestPrefix = (name: string) =>
  name
    .toUpperCase()
    .replaceAll(/[^A-Z]/g, "")
    .slice(0, 4);

// Parent product for repo/arc creation, from wherever the user is.
function deriveProductId(ws: WorkspacePayload, path: string): string | undefined {
  let m = /^\/(?:product|repo|arc)\/([^/]+)/.exec(path);
  if (m) {
    const id = m[1]!;
    return (
      ws.products.find((p) => p.id === id)?.id ??
      ws.repos.find((r) => r.id === id)?.productId ??
      ws.arcs.find((a) => a.id === id)?.productId
    );
  }
  m = /^\/issue\/([^/]+)/.exec(path);
  if (m) return findIssueByKey(ws, decodeURIComponent(m[1]!))?.issue.productId;
  return undefined;
}

export default function CreateContainerDialog({ workspace }: { workspace: WorkspacePayload }) {
  const [request, setRequest] = useState<ContainerDialogRequest | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [keyPrefix, setKeyPrefix] = useState("");
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [gitUrl, setGitUrl] = useState("");
  const [path, navigate] = useLocation();

  const activeProducts = workspace.products.filter((p) => !p.archivedAt);
  const activeInitiatives = workspace.initiatives.filter((i) => !i.archivedAt);

  useEffect(
    () =>
      onOpenCreateContainer((req) => {
        setRequest(req);
        setName("");
        setKeyPrefix("");
        setPrefixTouched(false);
        setGitUrl("");
        if (req.kind === "product") {
          setParentId(
            ("initiativeId" in req ? req.initiativeId : undefined) ?? activeInitiatives[0]?.id ?? "",
          );
        } else if (req.kind === "repo" || req.kind === "arc") {
          setParentId(
            ("productId" in req ? req.productId : undefined) ??
              deriveProductId(workspace, path) ??
              activeProducts[0]?.id ??
              "",
          );
        } else {
          setParentId("");
        }
      }),
    // Lists derive from workspace; path feeds the parent default.
    [workspace, path],
  );

  if (!request) return null;
  const kind = request.kind;

  const prefixOk = kind !== "product" || /^[A-Z]{2,8}$/.test(keyPrefix);
  const parentOk = kind === "initiative" || parentId !== "";
  const canSubmit = name.trim() !== "" && prefixOk && parentOk;

  const submit = () => {
    if (!canSubmit) return;
    const input: ContainerCreateInput =
      kind === "initiative"
        ? { kind, name }
        : kind === "product"
          ? { kind, name, initiativeId: parentId, keyPrefix }
          : kind === "repo"
            ? { kind, name, productId: parentId, gitUrl: gitUrl.trim() || null }
            : { kind, name, productId: parentId };
    const id = createContainer(input);
    setRequest(null);
    navigate(`/${kind}/${id}`);
  };

  const inputClass =
    "w-full rounded border border-line px-3 py-2 text-sm focus:border-ink-faint focus:outline-none";
  const selectClass =
    "rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft hover:border-ink-faint";

  return (
    <div className="fixed inset-0 z-50 bg-ink/20 p-4" onMouseDown={() => setRequest(null)}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") setRequest(null);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mx-auto mt-[12vh] max-w-lg rounded-xl border border-line bg-card p-4 shadow-2xl"
      >
        <h2 className="text-xs font-medium uppercase tracking-wide font-mono text-ink-faint">
          New {KIND_LABELS[kind]}
        </h2>
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (kind === "product" && !prefixTouched) setKeyPrefix(suggestPrefix(e.target.value));
          }}
          placeholder={`${KIND_LABELS[kind][0]!.toUpperCase()}${KIND_LABELS[kind].slice(1)} name`}
          className={`mt-2 ${inputClass}`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {kind === "product" && (
            <>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={selectClass}>
                {activeInitiatives.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <input
                value={keyPrefix}
                onChange={(e) => {
                  setKeyPrefix(e.target.value.toUpperCase().replaceAll(/[^A-Z]/g, "").slice(0, 8));
                  setPrefixTouched(true);
                }}
                placeholder="KEY"
                title="Issue-key prefix: 2–8 letters"
                className="w-24 rounded border border-line px-2 py-1 font-mono text-xs uppercase focus:border-ink-faint focus:outline-none"
              />
            </>
          )}
          {(kind === "repo" || kind === "arc") && (
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={selectClass}>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {kind === "repo" && (
            <input
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="Git URL (optional)"
              className="min-w-48 flex-1 rounded border border-line px-2 py-1 text-xs focus:border-ink-faint focus:outline-none"
            />
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setRequest(null)}
            className="rounded px-3 py-1 text-sm text-ink-soft hover:bg-line"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded bg-adobe px-3 py-1 text-sm text-white hover:bg-adobe-deep disabled:opacity-40"
          >
            Create {KIND_LABELS[kind]}
          </button>
        </div>
      </form>
    </div>
  );
}
