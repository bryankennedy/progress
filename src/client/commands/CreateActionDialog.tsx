// Action creation (SPEC §4: "create an action from anywhere"). The container
// defaults to wherever the user currently is — the open container page, the
// viewed action's container, or the board's active filters — so the common
// case is: press C, type a title, hit Enter.
//
// The layout mirrors the action page's sidebar (PROG-117): the same labeled,
// icon-guttered fields in the same order — Status, Location, Due date,
// Priority, Estimate — built from the shared fields.tsx primitives, so the
// two surfaces read as one system. Location renders the selection as the
// sidebar's glyphed mini-tree and picks via the same Workspace → Focus → Arc
// tree the palette's L picker lists (the shared locationRows helper), inline
// beneath the field so the dialog keeps focus.

import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ACTION_PRIORITIES,
  ACTION_STATUSES,
  DEFAULT_ACTION_STATUS,
  type ActionPriority,
  type ActionStatus,
} from "../../shared/constants";
import type { SnapshotPayload } from "../../shared/types";
import { sortByName } from "../boardFilters";
import {
  Field,
  FIELD_ACTION_CLS,
  GLYPH_BUTTON_CLS,
  IconDateInput,
  IconRow,
  IconSelect,
} from "../fields";
import { ArcGlyph, FocusGlyph, WorkspaceGlyph } from "../glyphs";
import { locationRows, type LocationRow } from "../locationRows";
import { PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import PriorityIndicator from "../PriorityIndicator";
import StatusIndicator from "../StatusIndicator";
import { createContainer, createAction, findActionByKey } from "../store";
import { onOpenCreateAction, type CreateDefaults } from "./controller";

// e.g. "My Side Project" → "MYSI"; the user can override.
const suggestPrefix = (name: string) =>
  name
    .toUpperCase()
    .replaceAll(/[^A-Z]/g, "")
    .slice(0, 4);

function deriveDefaults(ws: SnapshotPayload, path: string, search: string): CreateDefaults {
  let m = /^\/focus\/([^/]+)/.exec(path);
  if (m) return { focusId: m[1] };
  m = /^\/arc\/([^/]+)/.exec(path);
  if (m) {
    const arc = ws.arcs.find((a) => a.id === m![1]);
    if (arc) return { focusId: arc.focusId, arcId: arc.id };
  }
  m = /^\/action\/([^/]+)/.exec(path);
  if (m) {
    const found = findActionByKey(ws, decodeURIComponent(m[1]!));
    if (found) return { focusId: found.action.focusId };
  }
  // The board: honor its active container filters.
  const params = new URLSearchParams(search);
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
  const [status, setStatus] = useState<ActionStatus>(DEFAULT_ACTION_STATUS);
  const [priority, setPriority] = useState<ActionPriority>("none");
  const [dueDate, setDueDate] = useState("");
  // The Location field's inline tree picker (PROG-117): null = closed, else
  // the current filter query — the same tree the palette's L picker lists.
  const [pickerQuery, setPickerQuery] = useState<string | null>(null);
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
        setContainer(defaults.focusId ?? "");
        setArcId(defaults.arcId ?? "");
        setTitle("");
        setStatus(DEFAULT_ACTION_STATUS);
        setPriority("none");
        setDueDate("");
        setPickerQuery(null);
        setNewFocus(null);
        setNewArc(null);
        setOpen(true);
      }),
    [snapshot, path, search],
  );

  // `container` holds the selected focus id directly (PROG-102 dropped the
  // focus/repo encoding).
  const selectedFocusId = container || undefined;

  // Workspaces list alphabetically in the new-focus panel, like the filter
  // dropdowns (PROG-66, PROG-83) — a select is scanned by name. The location
  // picker instead follows outline rank (PROG-123b, via locationRows).
  const activeWorkspaces = sortByName(snapshot.workspaces.filter((i) => !i.archivedAt));

  // The current selection, rendered as the sidebar's Location mini-tree.
  const focus = snapshot.focuses.find((p) => p.id === selectedFocusId);
  const workspace = focus ? snapshot.workspaces.find((w) => w.id === focus.workspaceId) : undefined;
  const arc = arcId ? snapshot.arcs.find((a) => a.id === arcId) : undefined;

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
    setContainer(id);
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

  const rows = pickerQuery === null ? [] : locationRows(snapshot, pickerQuery);

  // Same semantics as the palette's picker (PROG-123b): a focus row means
  // "this focus, no arc"; an arc row lands focus + arc in one step.
  const pickLocation = (row: LocationRow) => {
    if (row.kind === "workspace") return;
    if (row.kind === "focus") {
      setContainer(row.id);
      setArcId("");
    } else {
      setContainer(row.focusId);
      setArcId(row.id);
    }
    setPickerQuery(null);
  };

  // The three Location panels are mutually exclusive — opening one closes the
  // others, so the field never stacks two forms.
  const togglePicker = () => {
    setPickerQuery((q) => (q === null ? "" : null));
    setNewFocus(null);
    setNewArc(null);
  };
  const toggleNewFocus = () => {
    setNewFocus((p) =>
      p ? null : { name: "", prefix: "", workspaceId: activeWorkspaces[0]?.id ?? "" },
    );
    setNewArc(null);
    setPickerQuery(null);
  };
  const toggleNewArc = () => {
    setNewArc((a) => (a === null ? "" : null));
    setNewFocus(null);
    setPickerQuery(null);
  };

  const submit = () => {
    const trimmed = title.trim();
    if (trimmed === "" || !selectedFocusId) return;
    const key = createAction({
      title: trimmed,
      focusId: selectedFocusId,
      arcId: arcId || null,
      parentActionId: null,
      status,
      priority,
      // No estimate at creation (PROG-117b) — it starts unset and gets sized
      // on the action page.
      estimate: null,
      dueDate: dueDate || null,
    });
    setOpen(false);
    if (key) navigate(`/action/${key}`);
  };

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
        // max-h + scroll: the labeled-field stack is taller than the old
        // one-line chip row, so short viewports scroll inside the dialog.
        className="mx-auto mt-[8vh] max-h-[84vh] max-w-lg overflow-y-auto rounded-xl border border-line bg-card p-4 shadow-2xl"
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

        {/* The sidebar's field anatomy in a creation-first order (PROG-117b):
            Location leads — where the action lands is the creation decision —
            with Status beside it, then Due date + Priority. Desktop is a
            two-column grid (Location | Status / Due date | Priority); mobile
            stacks one column, Location on top. The Location panels (tree
            picker / create forms) live in their own conditional cell that
            spans both columns on desktop — the tree gets the horizontal
            space under Status — while the `order-*` classes tuck it directly
            beneath the Location field in the mobile column (every cell
            carries an explicit order so the two sequences stay deliberate).
            items-start keeps a row's short cell pinned when its neighbour
            grows; min-w-0 lets long names truncate instead of stretching a
            column. No Estimate at creation — it defaults unset, sized later
            on the action page. */}
        <div className="mt-4 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 sm:gap-x-6">
          <Field label="Location" className="order-1 min-w-0">
            <IconRow
              align="start"
              icon={
                <button
                  type="button"
                  aria-label="Change location"
                  onClick={togglePicker}
                  className={`${GLYPH_BUTTON_CLS} text-ink-faint hover:text-ink-soft`}
                >
                  <WorkspaceGlyph />
                </button>
              }
            >
              {/* pl-2 aligns the value text with the select/input fields,
                  whose text sits inside a border + px-2 gutter (PROG-104). */}
              <div className="min-w-0 pl-2">
                {workspace && <p className="truncate text-sm">{workspace.name}</p>}
                {focus ? (
                  <p className="flex items-center gap-1.5 text-sm">
                    <span className="text-ink-faint">
                      <FocusGlyph />
                    </span>
                    <span className="truncate">{focus.name}</span>
                  </p>
                ) : (
                  <p className="text-sm text-ink-faint">No focus yet — create one below.</p>
                )}
                {arc && (
                  <p className="flex items-center gap-1.5 pl-3 text-sm">
                    <span className="text-ink-faint">
                      <ArcGlyph />
                    </span>
                    <span className="truncate">{arc.name}</span>
                  </p>
                )}
                <div className="mt-0.5 flex flex-wrap gap-x-4">
                  <button type="button" onClick={togglePicker} className={FIELD_ACTION_CLS}>
                    Change…
                  </button>
                  <button type="button" onClick={toggleNewFocus} className={FIELD_ACTION_CLS}>
                    + New focus
                  </button>
                  {selectedFocusId && (
                    <button type="button" onClick={toggleNewArc} className={FIELD_ACTION_CLS}>
                      + New arc
                    </button>
                  )}
                </div>
              </div>
            </IconRow>
          </Field>

          {/* The Location field's open panel — exactly one of the tree
              picker and the two create forms (they're mutually exclusive) —
              in its own full-width row on desktop. */}
          {(pickerQuery !== null || newFocus !== null || newArc !== null) && (
            <div className="order-2 min-w-0 sm:order-3 sm:col-span-2">
              {/* The inline tree picker: the same rows as the palette's L
                picker — inert workspace headers, focuses and arcs indented,
                rank-ordered, tree-aware filter. Escape closes just the
                picker; Enter picks the first (topmost) actionable row. */}
              {pickerQuery !== null && (
                <div className="overflow-hidden rounded-md border border-line bg-paper">
                  <input
                    autoFocus
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setPickerQuery(null);
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        const first = rows.find((r) => r.kind !== "workspace");
                        if (first) pickLocation(first);
                      }
                    }}
                    placeholder="Filter…"
                    className="w-full border-b border-line bg-transparent px-3 py-2 text-sm focus:outline-none"
                  />
                  <ul className="max-h-44 overflow-y-auto p-1">
                    {rows.map((row) =>
                      row.kind === "workspace" ? (
                        <li key={row.id}>
                          <div className="flex items-center gap-1.5 px-2 py-1 text-sm text-ink-faint">
                            <WorkspaceGlyph />
                            <span className="truncate">{row.name}</span>
                          </div>
                        </li>
                      ) : (
                        <li key={row.id}>
                          <button
                            type="button"
                            onClick={() => pickLocation(row)}
                            className={`flex w-full items-center justify-between gap-3 rounded py-1.5 pr-2 text-left text-sm hover:bg-line ${
                              row.kind === "arc" ? "pl-10" : "pl-6"
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="shrink-0 text-ink-faint">
                                {row.kind === "arc" ? <ArcGlyph /> : <FocusGlyph />}
                              </span>
                              <span className="truncate">{row.name}</span>
                            </span>
                            {(row.kind === "focus"
                              ? row.id === selectedFocusId && arcId === ""
                              : row.id === arcId) && (
                              <span className="shrink-0 text-xs text-ink-faint">current</span>
                            )}
                          </button>
                        </li>
                      ),
                    )}
                    {rows.every((r) => r.kind === "workspace") && (
                      <li className="px-3 py-4 text-center text-sm text-ink-faint">No matches.</li>
                    )}
                  </ul>
                </div>
              )}

              {/* Inline focus create (SPEC v2 §4): name + key prefix + workspace,
                created and selected without leaving the dialog. */}
              {newFocus && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper p-2">
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
                    onChange={(e) =>
                      setNewFocus((p) => (p ? { ...p, workspaceId: e.target.value } : p))
                    }
                    className="rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft hover:border-ink-faint"
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
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper p-2">
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
            </div>
          )}

          <Field label="Status" className="order-3 min-w-0 sm:order-2">
            <IconSelect
              icon={<StatusIndicator status={status} />}
              openLabel="Change status"
              value={status}
              options={ACTION_STATUSES.map((s) => [s, STATUS_LABELS[s]])}
              onChange={(v) => setStatus(v as ActionStatus)}
            />
          </Field>

          <Field label="Due date" className="order-4 min-w-0">
            <IconDateInput value={dueDate} onChange={setDueDate} />
          </Field>

          <Field label="Priority" className="order-5 min-w-0">
            <IconSelect
              icon={<PriorityIndicator priority={priority} />}
              openLabel="Change priority"
              value={priority}
              options={ACTION_PRIORITIES.map((p) => [p, PRIORITY_LABELS[p]])}
              onChange={(v) => setPriority(v as ActionPriority)}
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
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
