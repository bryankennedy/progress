import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import { Link, useLocation } from "wouter";
import {
  ISSUE_ESTIMATES,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssuePriority,
  type IssueStatus,
} from "../../shared/constants";
import type { WireActivity, WireComment, WireIssue, WorkspacePayload } from "../../shared/types";
import {
  addComment,
  findIssueByKey,
  issueKeyOf,
  updateIssue,
  useTimeline,
} from "../store";

const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};
const PRIORITY_LABELS: Record<IssuePriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function IssuePage({
  workspace,
  keyParam,
}: {
  workspace: WorkspacePayload;
  keyParam: string;
}) {
  const resolved = findIssueByKey(workspace, keyParam);
  const [, navigate] = useLocation();

  // Alias hit (old key from a cross-product move): permanent redirect to the
  // canonical key (SPEC §3).
  const canonicalKey = resolved ? issueKeyOf(workspace, resolved.issue) : null;
  useEffect(() => {
    if (resolved?.viaAlias && canonicalKey) {
      navigate(`/issue/${canonicalKey}`, { replace: true });
    }
  }, [resolved?.viaAlias, canonicalKey, navigate]);

  if (!resolved) {
    return (
      <p className="text-stone-500">
        No issue with key <span className="font-mono">{keyParam}</span>.{" "}
        <Link href="/" className="text-sky-600 hover:underline">
          Back to the workspace
        </Link>
      </p>
    );
  }
  const { issue } = resolved;

  const product = workspace.products.find((p) => p.id === issue.productId);
  const repo = issue.repoId ? workspace.repos.find((r) => r.id === issue.repoId) : null;
  const arc = issue.arcId ? workspace.arcs.find((a) => a.id === issue.arcId) : null;
  const issueTags = workspace.issueTags
    .filter((link) => link.issueId === issue.id)
    .map((link) => workspace.tags.find((t) => t.id === link.tagId))
    .filter((t) => t !== undefined);

  return (
    <>
      <nav className="text-sm text-stone-400">
        <Link href="/" className="hover:text-stone-600">
          Workspace
        </Link>{" "}
        / {product?.name ?? "?"}
        {repo ? ` / ${repo.name}` : ""}
      </nav>

      <header className="mt-4">
        <p className="font-mono text-sm text-stone-400">{canonicalKey}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{issue.title}</h1>
      </header>

      <div className="mt-6 flex flex-col gap-8 md:flex-row">
        <div className="min-w-0 flex-1">
          <DescriptionSection issue={issue} />
          <TimelineSection issue={issue} workspace={workspace} />
        </div>

        <aside className="w-full shrink-0 space-y-4 md:w-56">
          <Field label="Status">
            <FieldSelect
              value={issue.status}
              options={ISSUE_STATUSES.map((s) => [s, STATUS_LABELS[s]])}
              onChange={(v) => updateIssue(issue.id, { status: v as IssueStatus })}
            />
          </Field>
          <Field label="Priority">
            <FieldSelect
              value={issue.priority}
              options={ISSUE_PRIORITIES.map((p) => [p, PRIORITY_LABELS[p]])}
              onChange={(v) => updateIssue(issue.id, { priority: v as IssuePriority })}
            />
          </Field>
          <Field label="Estimate">
            <FieldSelect
              value={issue.estimate === null ? "" : String(issue.estimate)}
              options={[["", "—"], ...ISSUE_ESTIMATES.map((e): [string, string] => [String(e), String(e)])]}
              onChange={(v) => updateIssue(issue.id, { estimate: v === "" ? null : Number(v) })}
            />
          </Field>
          <Field label="Arc">
            <span className="text-sm">{arc?.name ?? "—"}</span>
          </Field>
          <Field label="Tags">
            {issueTags.length === 0 ? (
              <span className="text-sm text-stone-400">—</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {issueTags.map((tag) => (
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
          </Field>
          <div className="space-y-1 border-t border-stone-200 pt-3 text-xs text-stone-400">
            <p>Created {fmtTime(issue.createdAt)}</p>
            <p>Updated {fmtTime(issue.updatedAt)}</p>
            {issue.completedAt && <p>Completed {fmtTime(issue.completedAt)}</p>}
          </div>
        </aside>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-400">{label}</p>
      {children}
    </div>
  );
}

function FieldSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-stone-200 bg-white px-2 py-1 text-sm hover:border-stone-400"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

function DescriptionSection({ issue }: { issue: WireIssue }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (editing) {
    return (
      <section>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          autoFocus
          className="w-full rounded border border-stone-300 bg-white p-3 font-mono text-sm"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => {
              updateIssue(issue.id, { description: draft });
              setEditing(false);
            }}
            className="rounded bg-stone-900 px-3 py-1 text-sm text-white hover:bg-stone-700"
          >
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded px-3 py-1 text-sm text-stone-500 hover:bg-stone-100"
          >
            Cancel
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      onClick={() => {
        setDraft(issue.description);
        setEditing(true);
      }}
      className="group cursor-text rounded p-1 -m-1 hover:bg-white"
    >
      {issue.description === "" ? (
        <p className="text-stone-400">Add a description…</p>
      ) : (
        <div className="prose-lite">
          <Markdown>{issue.description}</Markdown>
        </div>
      )}
    </section>
  );
}

type TimelineEntry =
  | { kind: "comment"; at: string; comment: WireComment }
  | { kind: "activity"; at: string; event: WireActivity };

function TimelineSection({
  issue,
  workspace,
}: {
  issue: WireIssue;
  workspace: WorkspacePayload;
}) {
  const { data: timeline, isPending, error } = useTimeline(issue.id);
  const [draft, setDraft] = useState("");
  const userName = (id: string) => workspace.users.find((u) => u.id === id)?.name ?? id;

  const entries = useMemo(() => {
    if (!timeline) return [];
    const merged: TimelineEntry[] = [
      ...timeline.comments.map(
        (comment): TimelineEntry => ({ kind: "comment", at: comment.createdAt, comment }),
      ),
      ...timeline.activity.map(
        (event): TimelineEntry => ({ kind: "activity", at: event.createdAt, event }),
      ),
    ];
    return merged.sort((a, b) => a.at.localeCompare(b.at));
  }, [timeline]);

  return (
    <section className="mt-10 border-t border-stone-200 pt-6">
      <h2 className="text-sm font-medium uppercase tracking-wide text-stone-400">Activity</h2>

      {isPending && <p className="mt-3 text-sm text-stone-400">Loading…</p>}
      {error && <p className="mt-3 text-sm text-red-600">{String(error)}</p>}

      <ul className="mt-4 space-y-4">
        {entries.map((entry) =>
          entry.kind === "comment" ? (
            <li key={entry.comment.id} className="rounded-lg border border-stone-200 bg-white p-3">
              <p className="text-xs text-stone-400">
                <span className="font-medium text-stone-600">
                  {userName(entry.comment.authorId)}
                </span>{" "}
                · {fmtTime(entry.comment.createdAt)}
              </p>
              <div className="prose-lite mt-2 text-sm">
                <Markdown>{entry.comment.body}</Markdown>
              </div>
            </li>
          ) : (
            <li key={entry.event.id} className="px-3 text-xs text-stone-400">
              {describeActivity(entry.event)} · {fmtTime(entry.event.createdAt)}
            </li>
          ),
        )}
      </ul>

      <div className="mt-6">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Leave a comment… (Markdown)"
          className="w-full rounded border border-stone-200 bg-white p-3 text-sm focus:border-stone-400 focus:outline-none"
        />
        <button
          onClick={() => {
            const body = draft.trim();
            if (body === "") return;
            addComment(issue.id, body);
            setDraft("");
          }}
          className="mt-2 rounded bg-stone-900 px-3 py-1 text-sm text-white hover:bg-stone-700 disabled:opacity-40"
          disabled={draft.trim() === ""}
        >
          Comment
        </button>
      </div>
    </section>
  );
}

function describeActivity(event: WireActivity): string {
  if (event.type === "status_changed") {
    const data = event.data as { from?: IssueStatus; to?: IssueStatus };
    const label = (s: IssueStatus | undefined) => (s ? (STATUS_LABELS[s] ?? s) : "?");
    return `Status changed: ${label(data.from)} → ${label(data.to)}`;
  }
  return event.type.replaceAll("_", " ");
}
