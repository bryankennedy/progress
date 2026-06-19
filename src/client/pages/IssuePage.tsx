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
import type { PrState } from "../../shared/constants";
import type {
  WireActivity,
  WireComment,
  WireCommitLink,
  WireIssue,
  WirePrLink,
  WorkspacePayload,
} from "../../shared/types";
import { openPalette } from "../commands/controller";
import { useRegisterPageIssue } from "../commands/currentIssue";
import EditableMarkdown from "../EditableMarkdown";
import InlineEdit from "../InlineEdit";
import { PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import {
  addComment,
  findIssueByKey,
  issueKeyOf,
  updateIssue,
  useTimeline,
} from "../store";
import { copyBundleAsPrompt, copyWorkCommand, prefetchBundle } from "../workOn";

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

  // Makes this issue the target of the single-key actions (S/P/E/M).
  useRegisterPageIssue(resolved?.issue.id);

  // Alias hit (old key from a cross-product move): permanent redirect to the
  // canonical key (SPEC §3).
  const canonicalKey = resolved ? issueKeyOf(workspace, resolved.issue) : null;
  useEffect(() => {
    if (resolved?.viaAlias && canonicalKey) {
      navigate(`/issue/${canonicalKey}`, { replace: true });
    }
  }, [resolved?.viaAlias, canonicalKey, navigate]);

  // Warm the context bundle so "Work on this" copies instantly (SPEC §11.2).
  useEffect(() => {
    if (canonicalKey) prefetchBundle(canonicalKey);
  }, [canonicalKey]);

  if (!resolved) {
    return (
      <p className="text-ink-soft">
        No issue with key <span className="font-mono">{keyParam}</span>.{" "}
        <Link href="/" className="text-adobe hover:underline">
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
    <div className="mx-auto max-w-3xl">
      <nav className="text-sm text-ink-faint">
        <Link href="/" className="hover:text-ink-soft">
          Workspace
        </Link>{" "}
        /{" "}
        {product ? (
          <Link href={`/product/${product.id}`} className="hover:text-ink-soft">
            {product.name}
          </Link>
        ) : (
          "?"
        )}
        {repo && (
          <>
            {" / "}
            <Link href={`/repo/${repo.id}`} className="hover:text-ink-soft">
              {repo.name}
            </Link>
          </>
        )}
      </nav>

      <header className="mt-4">
        <p className="font-mono text-sm text-ink-faint">{canonicalKey}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          <InlineEdit
            value={issue.title}
            onSave={(title) => updateIssue(issue.id, { title })}
            validate={(v) => v !== ""}
            className="w-full"
            inputClassName="text-2xl font-semibold tracking-tight"
          />
        </h1>
      </header>

      <div className="mt-6 flex flex-col gap-8 md:flex-row">
        <div className="min-w-0 flex-1">
          <EditableMarkdown
            value={issue.description}
            placeholder="Add a description…"
            onSave={(description) => updateIssue(issue.id, { description })}
          />
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
          <Field label="Due date">
            <input
              type="date"
              value={issue.dueDate ?? ""}
              onChange={(e) => updateIssue(issue.id, { dueDate: e.target.value || null })}
              className="w-full rounded border border-line bg-card px-2 py-1 text-sm hover:border-ink-faint"
            />
          </Field>
          <Field label="Container">
            <p className="text-sm">
              {product?.name ?? "?"}
              {repo ? ` / ${repo.name}` : ""}
            </p>
            <button
              onClick={() => openPalette({ kind: "move", issueId: issue.id })}
              className="mt-0.5 text-xs text-adobe hover:underline"
            >
              Move… <span className="text-ink-faint">(M)</span>
            </button>
          </Field>
          <Field label="Arc">
            {arc ? (
              <Link href={`/arc/${arc.id}`} className="text-sm text-adobe-deep hover:underline">
                {arc.name}
              </Link>
            ) : (
              <span className="text-sm text-ink-faint">—</span>
            )}
            <button
              onClick={() => openPalette({ kind: "arc", issueId: issue.id })}
              className="mt-0.5 block text-xs text-adobe hover:underline"
            >
              Change… <span className="text-ink-faint">(A)</span>
            </button>
          </Field>
          <Field label="Tags">
            {issueTags.length === 0 ? (
              <span className="text-sm text-ink-faint">—</span>
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
            <button
              onClick={() => openPalette({ kind: "tag", issueId: issue.id })}
              className="mt-0.5 block text-xs text-adobe hover:underline"
            >
              Edit… <span className="text-ink-faint">(T)</span>
            </button>
          </Field>
          <Field label="Work on this">
            <button
              onClick={() => void copyBundleAsPrompt(issueKeyOf(workspace, issue))}
              className="block text-xs text-adobe hover:underline"
            >
              Copy as prompt <span className="text-ink-faint">(W)</span>
            </button>
            <button
              onClick={() => copyWorkCommand(issueKeyOf(workspace, issue))}
              className="mt-0.5 block text-xs text-adobe hover:underline"
            >
              Copy CLI command
            </button>
          </Field>
          <div className="space-y-1 border-t border-line pt-3 text-xs text-ink-faint">
            <p>Created {fmtTime(issue.createdAt)}</p>
            <p>Updated {fmtTime(issue.updatedAt)}</p>
            {issue.completedAt && <p>Completed {fmtTime(issue.completedAt)}</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide font-mono text-ink-faint">{label}</p>
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

  const hasGitLinks =
    timeline !== undefined && (timeline.pullRequests.length > 0 || timeline.commits.length > 0);

  return (
    <section className="mt-10 border-t border-line pt-6">
      {hasGitLinks && (
        <div className="mb-8">
          <h2 className="text-sm font-medium uppercase tracking-wide font-mono text-ink-faint">Git</h2>
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

      <h2 className="text-sm font-medium uppercase tracking-wide font-mono text-ink-faint">Activity</h2>

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
              {describeActivity(entry.event, workspace)} · {fmtTime(entry.event.createdAt)}
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
          className="w-full rounded border border-line bg-card p-3 text-sm focus:border-ink-faint focus:outline-none"
        />
        <button
          onClick={() => {
            const body = draft.trim();
            if (body === "") return;
            addComment(issue.id, body);
            setDraft("");
          }}
          className="mt-2 rounded bg-adobe px-3 py-1 text-sm text-white hover:bg-adobe-deep disabled:opacity-40"
          disabled={draft.trim() === ""}
        >
          Comment
        </button>
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

function describeActivity(event: WireActivity, workspace: WorkspacePayload): string {
  if (event.type === "status_changed") {
    const data = event.data as { from?: IssueStatus; to?: IssueStatus };
    const label = (s: IssueStatus | undefined) => (s ? (STATUS_LABELS[s] ?? s) : "?");
    return `Status changed: ${label(data.from)} → ${label(data.to)}`;
  }
  if (event.type === "moved") {
    const data = event.data as {
      fromProductId?: string;
      fromRepoId?: string | null;
      toProductId?: string;
      toRepoId?: string | null;
      fromKey?: string;
      toKey?: string;
    };
    const containerName = (productId?: string, repoId?: string | null) => {
      const product = workspace.products.find((p) => p.id === productId);
      const repo = repoId ? workspace.repos.find((r) => r.id === repoId) : undefined;
      return `${product?.name ?? "?"}${repo ? ` / ${repo.name}` : ""}`;
    };
    const rekeyed = data.fromKey ? ` (was ${data.fromKey})` : "";
    return `Moved: ${containerName(data.fromProductId, data.fromRepoId)} → ${containerName(data.toProductId, data.toRepoId)}${rekeyed}`;
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
