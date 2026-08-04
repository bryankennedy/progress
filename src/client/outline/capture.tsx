// The outline's capture inputs (PROG-124/107/140), extracted from Outline.tsx
// (PROG-141). Every "type a name → Enter" affordance in the tree lives here:
// the roving new-bullet action row, the two-field focus capture, the one-field
// arc/workspace capture, and the collapsed "+ new …" buttons that expand into
// them. They share one input class and one bullet-gutter so the rows line up
// pixel-for-pixel with the action bullets above them (PROG-111). None of these
// are on the drag-tick render path — they're leaf inputs — so this module is a
// pure relocation, no memoization/identity concerns.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createContainer } from "../store";
import { LevelIcon } from "./LevelIcon";

// The one input class every capture field shares: transparent until focused,
// then a faint card + ring (PROG-124). One constant so a tweak lands on all of
// them and none silently drift.
export const CAPTURE_INPUT_CLASS =
  "min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm text-ink placeholder:text-ink-faint focus:bg-card focus:ring-1 focus:ring-line";

// The w-6 bullet gutter every capture row opens with, so its input aligns with
// the rows' handle column (PROG-111). `faint` dims the glyph (the roving ＋).
function CaptureGutter({ children, faint = false }: { children: ReactNode; faint?: boolean }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center${faint ? " text-ink-faint/50" : ""}`}
      aria-hidden
    >
      {children}
    </span>
  );
}

// ---------- the capture (roving new-bullet) input ----------

// The draft is OWNED BY THE PARENT (PROG-107), not local state: this component
// unmounts and remounts every time capture roves (Tab/Shift+Tab, "+ action
// here", "back to top level"), and local state would silently drop whatever was
// typed. The parent also mirrors the draft to localStorage, so it survives
// navigation and reloads too.
export function CaptureRow({
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
      <CaptureGutter faint>＋</CaptureGutter>
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
        className={CAPTURE_INPUT_CLASS}
      />
    </div>
  );
}

// ---------- focus capture (name + key prefix) ----------

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

export function FocusCaptureRow({
  workspaceId,
  existingPrefixes,
  focusToken,
  onCreated,
  onCancel,
}: {
  workspaceId: string;
  existingPrefixes: Set<string>;
  focusToken: number;
  onCreated: () => void;
  // Present when the row is a collapsible capture (all scope, PROG-140): Escape
  // collapses it back to the "+ new focus" button. The always-visible
  // workspace-scope row omits it and never collapses.
  onCancel?: () => void;
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
      <CaptureGutter>
        <LevelIcon kind="focus" />
      </CaptureGutter>
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
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="New focus — Enter to add"
        className={CAPTURE_INPUT_CLASS}
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
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="KEY"
        title="Action-key prefix: 2–8 letters, unique across focuses"
        className={`w-16 shrink-0 rounded bg-transparent px-1 py-0.5 text-center font-mono text-2xs uppercase focus:bg-card focus:ring-1 ${
          clash ? "text-accent-deep ring-1 ring-accent" : "text-ink-faint focus:ring-line"
        }`}
      />
      {clash && <span className="shrink-0 text-2xs text-accent-deep">in use</span>}
    </div>
  );
}

// ---------- inline structure capture (PROG-140) ----------

// A one-field name capture for containers whose only required datum is a name —
// arcs and workspaces (a focus additionally needs its key prefix, so it keeps
// its own FocusCaptureRow). Enter creates and stays open for the next sibling
// (the Workflowy capture loop); Escape or blur collapses. The icon renders in
// the same w-6 gutter as the rows' bullet handle so the input lines up.
export function InlineCapture({
  icon,
  placeholder,
  depth = 0,
  onSubmit,
  onCancel,
}: {
  icon: ReactNode;
  placeholder: string;
  depth?: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: depth * 22 }}>
      <CaptureGutter>{icon}</CaptureGutter>
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const t = name.trim();
            if (t) {
              onSubmit(t);
              setName(""); // stay open for the next sibling
            }
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={onCancel}
        placeholder={placeholder}
        className={CAPTURE_INPUT_CLASS}
      />
    </div>
  );
}

// A "+ new focus" affordance for a workspace section at all scope (PROG-140):
// collapsed to a text button, expands to the shared FocusCaptureRow. Local
// open/token state keeps each workspace's capture independent.
export function NewFocusCapture({
  workspaceId,
  existingPrefixes,
}: {
  workspaceId: string;
  existingPrefixes: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(0);
  if (!open)
    return (
      <button
        onClick={() => {
          setOpen(true);
          setToken((t) => t + 1);
        }}
        className="ml-[30px] rounded px-1 py-0.5 text-xs text-ink-faint hover:bg-hover hover:text-ink-soft"
      >
        + new focus
      </button>
    );
  return (
    <FocusCaptureRow
      workspaceId={workspaceId}
      existingPrefixes={existingPrefixes}
      focusToken={token}
      onCreated={() => setToken((t) => t + 1)}
      onCancel={() => setOpen(false)}
    />
  );
}

// A "+ new workspace" affordance at the foot of the all scope (PROG-140):
// collapsed to a text button, expands to a bare name input (a workspace needs
// no key prefix). Creating stays open for the next one; Escape/blur collapses.
export function NewWorkspaceCapture() {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded px-1 py-0.5 text-sm text-ink-faint hover:bg-hover hover:text-ink-soft"
      >
        + new workspace
      </button>
    );
  return (
    <InlineCapture
      icon={<LevelIcon kind="workspace" />}
      placeholder="New workspace — Enter to add"
      onSubmit={(name) => createContainer({ kind: "workspace", name })}
      onCancel={() => setOpen(false)}
    />
  );
}
