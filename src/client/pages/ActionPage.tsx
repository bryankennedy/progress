import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "../Markdown";
import MarkdownTextarea from "../MarkdownTextarea";
import { Link, useLocation } from "wouter";
import {
  ACTION_ESTIMATES,
  ACTION_PRIORITIES,
  ACTION_STATUSES,
  type ActionPriority,
  type ActionStatus,
} from "../../shared/constants";
import type { PrState } from "../../shared/constants";
import type {
  WireActivity,
  WireComment,
  WireCommitLink,
  WireAction,
  WirePrLink,
  SnapshotPayload,
} from "../../shared/types";
import { sortByName } from "../boardFilters";
import Breadcrumb from "../Breadcrumb";
import { openPalette } from "../commands/controller";
import { useRegisterPageAction } from "../commands/currentAction";
import EditableMarkdown from "../EditableMarkdown";
import InlineEdit from "../InlineEdit";
import EstimateIndicator from "../EstimateIndicator";
import { PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import PriorityIndicator from "../PriorityIndicator";
import StatusIndicator from "../StatusIndicator";
import {
  actionAncestors,
  actionKeyOf,
  addComment,
  findActionByKey,
  updateAction,
  useTimeline,
} from "../store";
import { copyBundleAsPrompt, copyWorkCommand, prefetchBundle } from "../workOn";
import { clearDraft, readDraft, writeDraft } from "../drafts";
import { toastAction } from "../toast";

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// The field-edit triggers in the aside (Move… / Change… / Edit… / Copy…). They
// carry keyboard shortcuts on desktop, but on a phone tapping the link is the
// ONLY way to fire them — so give each a 44px-tall touch row on mobile while
// keeping the compact one-line-each layout on desktop (PROG-81). `flex` is
// block-level, so each still sits on its own line as `block` did.
const FIELD_ACTION_CLS =
  "flex min-h-11 items-center text-xs text-adobe hover:underline sm:block sm:min-h-0";

export default function ActionPage({
  snapshot,
  keyParam,
}: {
  snapshot: SnapshotPayload;
  keyParam: string;
}) {
  const resolved = findActionByKey(snapshot, keyParam);
  const [, navigate] = useLocation();
  // For the due-date gutter button (PROG-101): it opens the native picker.
  const dueDateRef = useRef<HTMLInputElement>(null);

  // Makes this action the target of the single-key actions (S/P/E/M).
  useRegisterPageAction(resolved?.action.id);

  // Alias hit (old key from a cross-focus move): permanent redirect to the
  // canonical key (SPEC §3).
  const canonicalKey = resolved ? actionKeyOf(snapshot, resolved.action) : null;
  useEffect(() => {
    if (resolved?.viaAlias && canonicalKey) {
      navigate(`/action/${canonicalKey}`, { replace: true });
    }
  }, [resolved?.viaAlias, canonicalKey, navigate]);

  // Warm the context bundle so "Work on this" copies instantly (SPEC §11.2).
  useEffect(() => {
    if (canonicalKey) prefetchBundle(canonicalKey);
  }, [canonicalKey]);

  if (!resolved) {
    return (
      <p className="text-ink-soft">
        No action with key <span className="font-mono">{keyParam}</span>.{" "}
        <Link href="/" className="text-adobe hover:underline">
          Back to the board
        </Link>
      </p>
    );
  }
  const { action } = resolved;

  const focus = snapshot.focuses.find((p) => p.id === action.focusId);
  const workspace = focus ? snapshot.workspaces.find((w) => w.id === focus.workspaceId) : undefined;
  const arc = action.arcId ? snapshot.arcs.find((a) => a.id === action.arcId) : null;
  // Empty for a top-level action, so its trail is unchanged (PROG-106).
  const ancestors = actionAncestors(snapshot, action);
  // Chips list alphabetically (PROG-83) — link insertion order means nothing.
  const actionTags = sortByName(
    snapshot.actionTags
      .filter((link) => link.actionId === action.id)
      .map((link) => snapshot.tags.find((t) => t.id === link.tagId))
      .filter((t) => t !== undefined),
  );

  return (
    <div className="mx-auto max-w-3xl overflow-hidden">
      {/* The action's place in the structure tree (PROG-103): Workspace /
          Focus / Arc / key, ancestors linked. The focus is the sole container
          (PROG-102) — its optional git repo lives in the sidebar's Focus field.
          The key is the terminal crumb, so the old standalone key line above
          the title is gone (it would repeat the same text one line apart).
          A Step continues the trail through its parent actions (PROG-106) —
          the containers stop at the arc, and the parent chain resumes the
          descent from there: … / Arc / PROG-4 / PROG-11. */}
      <Breadcrumb
        crumbs={[
          ...(workspace ? [{ label: workspace.name, href: `/workspace/${workspace.id}` }] : []),
          { label: focus?.name ?? "?", href: focus ? `/focus/${focus.id}` : undefined },
          ...(arc ? [{ label: arc.name, href: `/arc/${arc.id}` }] : []),
          ...ancestors.map((a) => {
            const key = actionKeyOf(snapshot, a);
            return { label: key, href: `/action/${key}`, mono: true };
          }),
          { label: canonicalKey ?? "?", mono: true },
        ]}
      />

      <header className="mt-4">
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          <InlineEdit
            value={action.title}
            onSave={(title) => updateAction(action.id, { title })}
            validate={(v) => v !== ""}
            className="w-full"
            inputClassName="text-2xl font-semibold tracking-tight"
          />
        </h1>
      </header>

      {/* Mobile-first ordering (mobile audit): description → field strip →
          timeline, so the primary actions (status/priority/due/…) aren't buried
          under a potentially long activity history on a phone. A grid pins the
          desktop layout (content in the left column across both rows, fields in
          the right column) while the single-column mobile flow just follows
          source order. */}
      {/* md:grid-rows-[auto_1fr]: the rail spans both rows, and when it's
          taller than the content column the grid would otherwise distribute
          its extra height across BOTH auto rows — inflating the description
          row and opening dead space above the timeline (PROG-90). Pinning
          row 1 to auto keeps the description content-sized; the 1fr timeline
          row absorbs the rail's surplus, leaving only the standard gap-8. */}
      <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_14rem] md:grid-rows-[auto_1fr]">
        <div className="min-w-0 md:col-start-1 md:row-start-1">
          <EditableMarkdown
            value={action.description}
            placeholder="Add a description…"
            draftScope={{ meId: snapshot.me?.id ?? "anon", targetId: action.id }}
            onSave={(description) =>
              updateAction(action.id, { description }, { toastOnError: false })
            }
          />
        </div>

        {/* min-w-0: a grid item defaults to min-width:auto, so it won't shrink
            below its content's intrinsic width. The native date input below has
            a wide intrinsic width on iOS, which otherwise stretches this whole
            column (and every w-full field in it) past the viewport — horizontal
            overflow on a phone. min-w-0 lets the track constrain it. */}
        <aside className="w-full min-w-0 overflow-hidden space-y-4 md:col-start-2 md:row-start-1 md:row-span-2">
          {/* Field order + the icon gutter (PROG-101, reworked PROG-104):
              every field carries a glyph on the left and its value in the same
              text column. Focus + Arc — the container switchers — lead, then
              status/due/priority/estimate, the standout Work-on-this panel, and
              Tags last. The Focus/Arc glyphs are buttons that open the move/arc
              palette (S/P/E/M/A shortcuts still fire regardless). */}
          <Field label="Focus">
            <IconRow
              icon={
                <button
                  type="button"
                  aria-label="Move to another focus (M)"
                  onClick={() => openPalette({ kind: "move", actionId: action.id })}
                  className={`${GLYPH_BUTTON_CLS} text-ink-faint hover:text-ink-soft`}
                >
                  <FocusGlyph />
                </button>
              }
            >
              {/* pl-2 aligns the value text with the select/input fields below,
                  whose text sits inside a border + px-2 gutter (PROG-104). */}
              <div className="min-w-0 pl-2">
                {focus ? (
                  <Link
                    href={`/focus/${focus.id}`}
                    className="block truncate text-sm hover:text-adobe-deep"
                  >
                    {focus.name}
                  </Link>
                ) : (
                  <span className="text-sm text-ink-faint">?</span>
                )}
                {focus?.gitUrl && (
                  <a
                    href={focus.gitUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate font-mono text-xs text-ink-faint hover:text-ink-soft hover:underline"
                  >
                    {focus.gitUrl.replace(/^https?:\/\//, "")}
                  </a>
                )}
                {/* Explicit "change" affordance (PROG-105): the gutter glyph
                    also opens this palette, but a modal-backed field needs a
                    visible trigger — the name itself links to the focus page.
                    Mirrors the Tags field's "Edit… (T)". */}
                <button
                  onClick={() => openPalette({ kind: "move", actionId: action.id })}
                  className={`mt-0.5 ${FIELD_ACTION_CLS}`}
                >
                  Change… <span className="ml-1 text-ink-faint">(M)</span>
                </button>
              </div>
            </IconRow>
          </Field>
          <Field label="Arc">
            <IconRow
              icon={
                <button
                  type="button"
                  aria-label="Change arc (A)"
                  onClick={() => openPalette({ kind: "arc", actionId: action.id })}
                  className={`${GLYPH_BUTTON_CLS} text-ink-faint hover:text-ink-soft`}
                >
                  <ArcGlyph />
                </button>
              }
            >
              <div className="min-w-0 pl-2">
                {arc ? (
                  <Link
                    href={`/arc/${arc.id}`}
                    className="block truncate text-sm hover:text-adobe-deep"
                  >
                    {arc.name}
                  </Link>
                ) : (
                  <span className="text-sm text-ink-faint">—</span>
                )}
                <button
                  onClick={() => openPalette({ kind: "arc", actionId: action.id })}
                  className={`mt-0.5 ${FIELD_ACTION_CLS}`}
                >
                  Change… <span className="ml-1 text-ink-faint">(A)</span>
                </button>
              </div>
            </IconRow>
          </Field>
          {/* A Step is an action with a parent (PROG-106 chain), so the label
              names which kind this page is showing (PROG-108). */}
          <Field label={action.parentActionId ? "Step Status" : "Action Status"}>
            <IconSelect
              icon={<StatusIndicator status={action.status} />}
              openLabel="Change status"
              value={action.status}
              options={ACTION_STATUSES.map((s) => [s, STATUS_LABELS[s]])}
              onChange={(v) => updateAction(action.id, { status: v as ActionStatus })}
            />
          </Field>
          {/* Complete action (PROG-108): one-click move to done, right under
              the status field it short-cuts, in the same filled primary-CTA
              style as the Work-on-this button below so finishing work is as
              prominent as starting it. Hidden once the action is already
              done — the status select still covers reopen. */}
          {action.status !== "done" && (
            <button
              onClick={() => updateAction(action.id, { status: "done" })}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md bg-adobe px-3 py-2 text-sm font-medium text-white hover:bg-adobe-deep sm:min-h-0"
            >
              Complete action
              <CheckGlyph />
            </button>
          )}
          <Field label="Due date">
            <IconRow
              icon={
                <button
                  type="button"
                  aria-label="Open calendar"
                  onClick={() => {
                    // The calendar button, moved from the input's right edge
                    // (native indicator, hidden below) into the shared left
                    // gutter. showPicker needs a user gesture and is missing
                    // on older Safari — fall back to focusing the input.
                    try {
                      dueDateRef.current?.showPicker();
                    } catch {
                      dueDateRef.current?.focus();
                    }
                  }}
                  className={`${GLYPH_BUTTON_CLS} text-ink-faint hover:text-ink-soft`}
                >
                  <CalendarGlyph />
                </button>
              }
            >
              <input
                ref={dueDateRef}
                type="date"
                value={action.dueDate ?? ""}
                onChange={(e) => updateAction(action.id, { dueDate: e.target.value || null })}
                // w-full + min-w-0 + max-w-full: pin the native date control to
                // the column width instead of letting its (wide, on iOS Safari)
                // intrinsic size win. iOS renders a localized label ("Jun 30, 2026")
                // wider than the Android/Chrome "06/30/2026", and its intrinsic
                // min-width can push past the viewport even with min-w-0. The
                // explicit max-w-full + box-border ensures the border-box never
                // exceeds the parent, and the [&::-webkit-date-and-time-value]
                // override left-aligns the text (Safari centers it by default,
                // burning horizontal space on both sides). The native
                // right-edge picker indicator hides because the gutter button
                // replaces it (PROG-101).
                className="w-full min-w-0 max-w-full box-border rounded border border-line bg-card px-2 py-1 text-sm hover:border-ink-faint [&::-webkit-date-and-time-value]:text-left [&::-webkit-calendar-picker-indicator]:hidden"
              />
            </IconRow>
          </Field>
          <Field label="Priority">
            <IconSelect
              icon={<PriorityIndicator priority={action.priority} />}
              openLabel="Change priority"
              value={action.priority}
              options={ACTION_PRIORITIES.map((p) => [p, PRIORITY_LABELS[p]])}
              onChange={(v) => updateAction(action.id, { priority: v as ActionPriority })}
            />
          </Field>
          <Field label="Estimate">
            <IconSelect
              icon={<EstimateIndicator estimate={action.estimate} />}
              openLabel="Change estimate"
              value={action.estimate === null ? "" : String(action.estimate)}
              options={[
                ["", "—"],
                ...ACTION_ESTIMATES.map((e): [string, string] => [String(e), String(e)]),
              ]}
              onChange={(v) => updateAction(action.id, { estimate: v === "" ? null : Number(v) })}
            />
          </Field>
          {/* Work on this (PROG-104): the agent-kickoff, lifted out of the plain
              field rhythm into a tinted action panel so it reads as the sidebar's
              primary call-to-action — hand this action to an agent and jump
              forward in Progress. The filled adobe button + forward arrow
              (nudged on hover) is the app's primary-CTA style (cf. the header
              New button). */}
          <div className="rounded-lg border border-adobe-wash bg-adobe-wash/30 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide font-mono text-adobe-deep">
              Work on this
            </p>
            <button
              onClick={() => void copyBundleAsPrompt(actionKeyOf(snapshot, action))}
              className="group flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md bg-adobe px-3 py-2 text-sm font-medium text-white hover:bg-adobe-deep sm:min-h-0"
            >
              Copy as prompt
              <ArrowGlyph className="transition-transform group-hover:translate-x-0.5" />
              <span className="text-white/70">(W)</span>
            </button>
            <button
              onClick={() => copyWorkCommand(actionKeyOf(snapshot, action))}
              className="mt-1.5 flex min-h-11 w-full items-center justify-center text-xs text-adobe-deep hover:underline sm:min-h-0"
            >
              Copy CLI command
            </button>
          </div>
          <Field label="Tags">
            {actionTags.length === 0 ? (
              <span className="text-sm text-ink-faint">—</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {actionTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full px-2 py-0.5 text-xs text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
              </span>
            )}
            <button
              onClick={() => openPalette({ kind: "tag", actionId: action.id })}
              className={`mt-0.5 ${FIELD_ACTION_CLS}`}
            >
              Edit… <span className="ml-1 text-ink-faint">(T)</span>
            </button>
          </Field>
          <div className="space-y-1 border-t border-line pt-3 text-xs text-ink-faint">
            <p>Created {fmtTime(action.createdAt)}</p>
            <p>Updated {fmtTime(action.updatedAt)}</p>
            {action.completedAt && <p>Completed {fmtTime(action.completedAt)}</p>}
          </div>
        </aside>

        <div className="min-w-0 md:col-start-1 md:row-start-2">
          <TimelineSection action={action} snapshot={snapshot} />
        </div>
      </div>
    </div>
  );
}

// The shared icon gutter for the sidebar's editable fields (PROG-101): glyph
// on the left, control filling the rest, so the four rows align vertically.
function IconRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// Every gutter glyph is a button (PROG-101b): slight padding for a bigger hit
// target, a hover wash for affordance.
const GLYPH_BUTTON_CLS = "-m-1 flex rounded p-1 hover:bg-line";

// A FieldSelect whose gutter glyph doubles as a picker button (PROG-101b):
// clicking the glyph pops the select's dropdown, mirroring the due-date
// calendar button, so the icon column is uniformly actionable.
function IconSelect({
  icon,
  openLabel,
  value,
  options,
  onChange,
}: {
  icon: React.ReactNode;
  openLabel: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLSelectElement>(null);
  return (
    <IconRow
      icon={
        <button
          type="button"
          aria-label={openLabel}
          onClick={() => {
            // showPicker is the only script API that pops a native select
            // open; where it's missing (older Safari) fall back to focusing —
            // Space/Enter then opens it.
            try {
              ref.current?.showPicker();
            } catch {
              ref.current?.focus();
            }
          }}
          className={GLYPH_BUTTON_CLS}
        >
          {icon}
        </button>
      }
    >
      <FieldSelect ref={ref} value={value} options={options} onChange={onChange} />
    </IconRow>
  );
}

// The due-date field's calendar glyph — same 16×16 box and size as the
// indicator glyphs so the gutter column lines up.
function CalendarGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="inline-block h-3.5 w-3.5 shrink-0">
      <rect
        x="2"
        y="3"
        width="12"
        height="11"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M2.75 6.5 H13.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5.25 1.75 V4 M10.75 1.75 V4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="5.5" cy="9.5" r="1" fill="currentColor" />
      <circle cx="8" cy="9.5" r="1" fill="currentColor" />
      <circle cx="10.5" cy="9.5" r="1" fill="currentColor" />
    </svg>
  );
}

// Focus gutter glyph (PROG-104): a target/crosshair — the focus is the thing
// the action is "focused" on. Same 16×16 box as the other gutter glyphs.
function FocusGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="inline-block h-3.5 w-3.5 shrink-0">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2.25" fill="currentColor" />
    </svg>
  );
}

// Arc gutter glyph (PROG-104): a rainbow-like arc between two endpoints — the
// milestone trajectory an arc groups actions along.
function ArcGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="inline-block h-3.5 w-3.5 shrink-0">
      <path
        d="M2.75 11.5 A 5.25 5.25 0 0 1 13.25 11.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="2.75" cy="11.5" r="1.4" fill="currentColor" />
      <circle cx="13.25" cy="11.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

// The "Work on this" forward arrow (PROG-104): evokes jumping forward in
// Progress. Accepts a class so the button can nudge it on hover.
function ArrowGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={`inline-block h-3.5 w-3.5 shrink-0 ${className}`}
    >
      <path
        d="M2.75 8 H12.25 M8.5 4.25 L12.25 8 L8.5 11.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The "Complete action" check mark (PROG-108) — same 16×16 box and stroke
// weight as the other button glyphs.
function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="inline-block h-3.5 w-3.5 shrink-0">
      <path
        d="M3 8.5 L6.5 12 L13 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide font-mono text-ink-faint">
        {label}
      </p>
      {children}
    </div>
  );
}

function FieldSelect({
  value,
  options,
  onChange,
  ref,
}: {
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  // React 19 ref-as-prop; IconSelect uses it to pop the dropdown open.
  ref?: React.Ref<HTMLSelectElement>;
}) {
  return (
    <select
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-line bg-card px-2 py-1 text-sm hover:border-ink-faint"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

type TimelineEntry =
  | { kind: "comment"; at: string; comment: WireComment }
  | { kind: "activity"; at: string; event: WireActivity };

function TimelineSection({ action, snapshot }: { action: WireAction; snapshot: SnapshotPayload }) {
  const { data: timeline, isPending, error } = useTimeline(action.id);
  const meId = snapshot.me?.id ?? "anon";
  // Comment draft persists to localStorage as you type (PROG-51), so unsent text
  // survives a tab close, reload, or a failed/timed-out post. Cleared only once
  // the server confirms the comment.
  const [draft, setDraft] = useState(() => readDraft("comment", meId, action.id));
  const [sending, setSending] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Always-current mirror of `draft`, so the post-send success handler can tell
  // whether the field still holds the text it sent vs. a new comment typed while
  // the (possibly slow/retried) send was in flight.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const userName = (id: string) => snapshot.users.find((u) => u.id === id)?.name ?? id;

  // Re-hydrate when navigating between actions (this section is keyed by action id
  // but remounts may reuse state) or once the signed-in user resolves.
  useEffect(() => {
    setDraft(readDraft("comment", meId, action.id));
  }, [meId, action.id]);
  useEffect(() => () => clearTimeout(debounce.current), []);

  function onDraftChange(next: string) {
    setDraft(next);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => writeDraft("comment", meId, action.id, next), 400);
  }

  // Send an explicit body (not read from state) so a Retry re-sends exactly that
  // text without a stale-closure read. The text stays in the field and in
  // localStorage until the server confirms, then both are cleared — so a failed
  // or in-flight send never loses it.
  async function sendComment(body: string): Promise<boolean> {
    setSending(true);
    const ok = await addComment(action.id, body);
    setSending(false);
    if (ok) {
      // Only clear if the field still holds the text we sent. If the user typed a
      // new comment while this (possibly retried) send was in flight, leave it —
      // clearing here would silently destroy their unsent work, the very loss
      // PROG-51 exists to prevent.
      if (draftRef.current.trim() === body) {
        clearTimeout(debounce.current);
        setDraft("");
        clearDraft("comment", meId, action.id);
      }
    } else {
      toastAction(
        "Couldn't post that comment — your text is saved here.",
        { label: "Retry", run: () => void sendComment(body) },
        `comment:${action.id}`,
      );
    }
    return ok;
  }

  function submitComment() {
    const body = draft.trim();
    if (body === "" || sending) return;
    void sendComment(body);
  }

  // Comment & close (PROG-108): post the comment, then move the action to
  // done — the "leave a wrap-up note and finish" flow in one click. The close
  // only follows a confirmed comment; on failure the draft-preserving Retry
  // toast re-sends just the comment, and the user closes once it lands.
  async function submitCommentAndClose() {
    const body = draft.trim();
    if (body === "" || sending) return;
    const ok = await sendComment(body);
    if (ok) void updateAction(action.id, { status: "done" });
  }

  const entries = useMemo(() => {
    if (!timeline) return [];
    const merged: TimelineEntry[] = [
      ...timeline.comments.map((comment): TimelineEntry => ({
        kind: "comment",
        at: comment.createdAt,
        comment,
      })),
      ...timeline.activity.map((event): TimelineEntry => ({
        kind: "activity",
        at: event.createdAt,
        event,
      })),
    ];
    return merged.sort((a, b) => a.at.localeCompare(b.at));
  }, [timeline]);

  const hasGitLinks =
    timeline !== undefined && (timeline.pullRequests.length > 0 || timeline.commits.length > 0);

  return (
    // No own top margin: the page grid's gap-8 is the spacing between the
    // description and this section (PROG-90) — an extra mt here stacked onto
    // the gap and read as dead space under a short/empty description.
    <section className="border-t border-line pt-6">
      {hasGitLinks && (
        <div className="mb-8">
          <h2 className="text-sm font-medium uppercase tracking-wide font-mono text-ink-faint">
            Git
          </h2>
          <div className="mt-3 space-y-1.5">
            {timeline.pullRequests.map((pr) => (
              <PrRow key={`${pr.githubRepo}#${pr.prNumber}`} pr={pr} />
            ))}
            {timeline.commits.map((commit) => (
              <CommitRow key={commit.sha} commit={commit} />
            ))}
          </div>
        </div>
      )}

      <h2 className="text-sm font-medium uppercase tracking-wide font-mono text-ink-faint">
        Activity
      </h2>

      {isPending && <p className="mt-3 text-sm text-ink-faint">Loading…</p>}
      {error && <p className="mt-3 text-sm text-danger">{String(error)}</p>}

      <ul className="mt-4 space-y-4">
        {entries.map((entry) =>
          entry.kind === "comment" ? (
            <li key={entry.comment.id} className="rounded-lg border border-line bg-card p-3">
              <p className="text-xs text-ink-faint">
                <span className="font-medium text-ink-soft">
                  {userName(entry.comment.authorId)}
                </span>{" "}
                · {fmtTime(entry.comment.createdAt)}
              </p>
              <div className="prose-lite mt-2 text-sm">
                <Markdown>{entry.comment.body}</Markdown>
              </div>
            </li>
          ) : (
            <li key={entry.event.id} className="px-3 text-xs text-ink-faint">
              {describeActivity(entry.event, snapshot)} · {fmtTime(entry.event.createdAt)}
            </li>
          ),
        )}
      </ul>

      <div className="mt-6">
        <MarkdownTextarea
          value={draft}
          onChange={onDraftChange}
          rows={3}
          placeholder="Leave a comment… (Markdown)"
          className="w-full rounded border border-line bg-card p-3 text-sm focus:border-ink-faint focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={submitComment}
            className="rounded bg-adobe px-3 py-1 text-sm text-white hover:bg-adobe-deep disabled:opacity-40"
            disabled={draft.trim() === "" || sending}
          >
            Comment
          </button>
          {/* Same done-move as the sidebar's Complete action (PROG-108), but
              bundled with the comment post. Tinted with the Work-on-this
              panel's adobe wash — colorful enough to read as an action, still
              a step below the filled Comment primary; hidden once done. */}
          {action.status !== "done" && (
            <button
              onClick={() => void submitCommentAndClose()}
              className="rounded border border-adobe-wash bg-adobe-wash/40 px-3 py-1 text-sm text-adobe-deep hover:bg-adobe-wash/70 disabled:opacity-40"
              disabled={draft.trim() === "" || sending}
            >
              Comment &amp; close
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

const PR_STATE_STYLES: Record<PrState, string> = {
  open: "bg-adobe-wash/40 text-adobe-deep",
  merged: "bg-moss-wash/50 text-moss-deep",
  closed: "bg-line text-ink-soft",
};

function PrRow({ pr }: { pr: WirePrLink }) {
  return (
    <a
      href={pr.url || undefined}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm hover:border-ink-faint"
    >
      <span
        className={`shrink-0 rounded-full px-2 py-px text-[10px] font-medium uppercase ${PR_STATE_STYLES[pr.state]}`}
      >
        {pr.state}
      </span>
      <span className="truncate font-medium">{pr.title}</span>
      <span className="ml-auto shrink-0 text-xs text-ink-faint">
        {pr.githubRepo}#{pr.prNumber}
      </span>
    </a>
  );
}

function CommitRow({ commit }: { commit: WireCommitLink }) {
  return (
    <a
      href={commit.url || undefined}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-1.5 text-xs hover:border-ink-faint"
    >
      <span className="shrink-0 font-mono text-ink-faint">{commit.sha.slice(0, 7)}</span>
      <span className="truncate text-ink-soft">{commit.message}</span>
      <span className="ml-auto shrink-0 text-ink-faint">{commit.githubRepo}</span>
    </a>
  );
}

function describeActivity(event: WireActivity, snapshot: SnapshotPayload): string {
  if (event.type === "status_changed") {
    const data = event.data as { from?: ActionStatus; to?: ActionStatus };
    const label = (s: ActionStatus | undefined) => (s ? (STATUS_LABELS[s] ?? s) : "?");
    return `Status changed: ${label(data.from)} → ${label(data.to)}`;
  }
  if (event.type === "moved") {
    // A move is focus-to-focus (PROG-102). Pre-PROG-102 events may also carry
    // from/toRepoId; those are ignored now that repo isn't a container.
    const data = event.data as {
      fromFocusId?: string;
      toFocusId?: string;
      fromKey?: string;
      toKey?: string;
    };
    const focusName = (focusId?: string) =>
      snapshot.focuses.find((p) => p.id === focusId)?.name ?? "?";
    const rekeyed = data.fromKey ? ` (was ${data.fromKey})` : "";
    return `Moved: ${focusName(data.fromFocusId)} → ${focusName(data.toFocusId)}${rekeyed}`;
  }
  if (event.type === "pr_linked") {
    const data = event.data as { githubRepo?: string; prNumber?: number; title?: string };
    return `Linked PR ${data.githubRepo ?? "?"}#${data.prNumber ?? "?"}: ${data.title ?? ""}`;
  }
  if (event.type === "commit_linked") {
    const data = event.data as { sha?: string; message?: string };
    return `Linked commit ${(data.sha ?? "").slice(0, 7)}: ${data.message ?? ""}`;
  }
  return event.type.replaceAll("_", " ");
}
