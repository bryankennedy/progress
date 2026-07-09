// Action creation (SPEC §4: "create an action from anywhere"). The container
// defaults to wherever the user currently is — the open container page, the
// viewed action's container, or the board's active filters — so the common
// case is: press C, type a title, hit Enter.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ACTION_ESTIMATES,
  ACTION_PRIORITIES,
  ACTION_STATUSES,
  type ActionPriority,
  type ActionStatus,
} from "../../shared/constants";
import type { SnapshotPayload } from "../../shared/types";
import { sortByName } from "../boardFilters";
import { PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import { createContainer, createAction, findActionByKey } from "../store";
import { onOpenCreateAction, type CreateDefaults } from "./controller";

// e.g. "My Side Project" → "MYSI"; the user can override.
const suggestPrefix = (name: string) =>
  name
    .toUpperCase()
    .replaceAll(/[^A-Z]/g, "")
    .slice(0, 4);

// The container <select> encodes "focus-level or repo" in one value.
const containerValue = (d: CreateDefaults) =>
  d.repoId ? `r:${d.repoId}` : d.focusId ? `p:${d.focusId}` : "";

function deriveDefaults(ws: SnapshotPayload, path: string, search: string): CreateDefaults {
  let m = /^\/focus\/([^/]+)/.exec(path);
  if (m) return { focusId: m[1] };
  m = /^\/repo\/([^/]+)/.exec(path);
  if (m) {
    const repo = ws.repos.find((r) => r.id === m![1]);
    if (repo) return { focusId: repo.focusId, repoId: repo.id };
  }
  m = /^\/arc\/([^/]+)/.exec(path);
  if (m) {
    const arc = ws.arcs.find((a) => a.id === m![1]);
    if (arc) return { focusId: arc.focusId, arcId: arc.id };
  }
  m = /^\/action\/([^/]+)/.exec(path);
  if (m) {
    const found = findActionByKey(ws, decodeURIComponent(m[1]!));
    if (found) return { focusId: found.action.focusId, repoId: found.action.repoId };
  }
  // The board: honor its active container filters.
  const params = new URLSearchParams(search);
  const repo = ws.repos.find((r) => r.id === params.get("repo"));
  if (repo) return { focusId: repo.focusId, repoId: repo.id };
  const arc = ws.arcs.find((a) => a.id === params.get("arc"));
  if (arc) return { focusId: arc.focusId, arcId: arc.id };
  const focus = ws.focuses.find((p) => p.id === params.get("focus"));
  if (focus) return { focusId: focus.id };
  return {};
}

export default function CreateActionDialog({ snapshot }: { snapshot: SnapshotPayload }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [container, setContainer] = useState("");
  const [arcId, setArcId] = useState("");
  const [status, setStatus] = useState<ActionStatus>("todo");
  const [priority, setPriority] = useState<ActionPriority>("none");
  const [estimate, setEstimate] = useState("");
  const [dueDate, setDueDate] = useState("");
  // Inline structure creation (SPEC v2 §4): spin up a focus or arc without
  // leaving the dialog; the new container is created optimistically and
  // selected in place. `null` = panel closed.
  const [newFocus, setNewFocus] = useState<{
    name: string;
    prefix: string;
    workspaceId: string;
  } | null>(null);
  const [newArc, setNewArc] = useState<string | null>(null);
  const [path, navigate] = useLocation();
  const search = useSearch();

  useEffect(
    () =>
      onOpenCreateAction((given) => {
        const defaults = { ...deriveDefaults(snapshot, path, search), ...given };
        if (!defaults.focusId) defaults.focusId = snapshot.focuses.find((p) => !p.archivedAt)?.id;
        setContainer(containerValue(defaults));
        setArcId(defaults.arcId ?? "");
        setTitle("");
        setStatus("todo");
        setPriority("none");
        setEstimate("");
        setDueDate("");
        setNewFocus(null);
        setNewArc(null);
        setOpen(true);
      }),
    [snapshot, path, search],
  );

  const selectedFocusId = useMemo(() => {
    if (container.startsWith("p:")) return container.slice(2);
    if (container.startsWith("r:"))
      return snapshot.repos.find((r) => r.id === container.slice(2))?.focusId;
    return undefined;
  }, [container, snapshot.repos]);

  // Archived containers aren't valid creation targets (D26).
  // Pickers list options alphabetically, like the filter dropdowns (PROG-66,
  // PROG-83) — a select is scanned by name.
  const activeFocuses = sortByName(snapshot.focuses.filter((p) => !p.archivedAt));
  const activeWorkspaces = sortByName(snapshot.workspaces.filter((i) => !i.archivedAt));
  const focusArcs = sortByName(
    snapshot.arcs.filter((a) => a.focusId === selectedFocusId && !a.archivedAt),
  );

  const submitNewFocus = () => {
    if (!newFocus) return;
    const name = newFocus.name.trim();
    if (name === "" || !/^[A-Z]{2,8}$/.test(newFocus.prefix) || !newFocus.workspaceId) return;
    const id = createContainer({
      kind: "focus",
      name,
      workspaceId: newFocus.workspaceId,
      keyPrefix: newFocus.prefix,
    });
    setContainer(`p:${id}`);
    setArcId("");
    setNewFocus(null);
  };

  const submitNewArc = () => {
    if (newArc === null || newArc.trim() === "" || !selectedFocusId) return;
    const id = createContainer({ kind: "arc", name: newArc.trim(), focusId: selectedFocusId });
    setArcId(id);
    setNewArc(null);
  };

  if (!open) return null;

  const onContainerChange = (value: string) => {
    setContainer(value);
    const focusId = value.startsWith("p:")
      ? value.slice(2)
      : snapshot.repos.find((r) => r.id === value.slice(2))?.focusId;
    // Arc must stay within the action's focus (SPEC §3).
    setArcId((a) => (snapshot.arcs.find((x) => x.id === a)?.focusId === focusId ? a : ""));
  };

  const submit = () => {
    const trimmed = title.trim();
    if (trimmed === "" || !selectedFocusId) return;
    const key = createAction({
      title: trimmed,
      focusId: selectedFocusId,
      repoId: container.startsWith("r:") ? container.slice(2) : null,
      arcId: arcId || null,
      parentActionId: null,
      status,
      priority,
      estimate: estimate === "" ? null : Number(estimate),
      dueDate: dueDate || null,
    });
    setOpen(false);
    if (key) navigate(`/action/${key}`);
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
        <h2 className="text-xs font-medium uppercase tracking-wide font-mono text-ink-faint">
          New action
        </h2>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Action title"
          className="mt-2 w-full rounded border border-line px-3 py-2 text-sm focus:border-ink-faint focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={container}
            onChange={(e) => onContainerChange(e.target.value)}
            className={selectClass}
          >
            {activeFocuses.map((p) => {
              const focusRepos = sortByName(
                snapshot.repos.filter((r) => r.focusId === p.id && !r.archivedAt),
              );
              return (
                <optgroup key={p.id} label={p.name}>
                  <option value={`p:${p.id}`}>{p.name}</option>
                  {focusRepos.map((r) => (
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
              setNewFocus((p) =>
                p ? null : { name: "", prefix: "", workspaceId: activeWorkspaces[0]?.id ?? "" },
              )
            }
            className={selectClass}
          >
            + New focus
          </button>
          {focusArcs.length > 0 && (
            <select
              value={arcId}
              onChange={(e) => setArcId(e.target.value)}
              className={selectClass}
            >
              <option value="">No arc</option>
              {focusArcs.map((a) => (
                <option key={a.id} value={a.id}>
                  Arc: {a.name}
                </option>
              ))}
            </select>
          )}
          {selectedFocusId && (
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
            onChange={(e) => setStatus(e.target.value as ActionStatus)}
            className={selectClass}
          >
            {ACTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as ActionPriority)}
            className={selectClass}
          >
            {ACTION_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          <select
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            className={selectClass}
          >
            <option value="">No estimate</option>
            {ACTION_ESTIMATES.map((e) => (
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

        {/* Inline focus create (SPEC v2 §4): name + key prefix + workspace,
            created and selected without leaving the dialog. */}
        {newFocus && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-line bg-paper p-2">
            <input
              autoFocus
              value={newFocus.name}
              onChange={(e) =>
                setNewFocus((p) =>
                  p
                    ? {
                        ...p,
                        name: e.target.value,
                        prefix: p.prefix || suggestPrefix(e.target.value),
                      }
                    : p,
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitNewFocus();
                }
              }}
              placeholder="Focus name"
              className="min-w-40 flex-1 rounded border border-line px-2 py-1 text-xs focus:border-ink-faint focus:outline-none"
            />
            <input
              value={newFocus.prefix}
              onChange={(e) =>
                setNewFocus((p) =>
                  p
                    ? {
                        ...p,
                        prefix: e.target.value
                          .toUpperCase()
                          .replaceAll(/[^A-Z]/g, "")
                          .slice(0, 8),
                      }
                    : p,
                )
              }
              placeholder="KEY"
              title="Action-key prefix: 2–8 letters"
              className="w-20 rounded border border-line px-2 py-1 font-mono text-xs uppercase focus:border-ink-faint focus:outline-none"
            />
            <select
              value={newFocus.workspaceId}
              onChange={(e) => setNewFocus((p) => (p ? { ...p, workspaceId: e.target.value } : p))}
              className={selectClass}
            >
              {activeWorkspaces.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={submitNewFocus}
              disabled={
                newFocus.name.trim() === "" ||
                !/^[A-Z]{2,8}$/.test(newFocus.prefix) ||
                !newFocus.workspaceId
              }
              className="rounded bg-adobe px-2 py-1 text-xs text-white hover:bg-adobe-deep disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}

        {/* Inline arc create (SPEC v2 §4): a name within the selected focus. */}
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
              disabled={newArc.trim() === "" || !selectedFocusId}
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
            disabled={title.trim() === "" || !selectedFocusId}
            className="rounded bg-adobe px-3 py-1 text-sm text-white hover:bg-adobe-deep disabled:opacity-40"
          >
            Create action
          </button>
        </div>
      </form>
    </div>
  );
}
