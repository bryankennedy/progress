// Shared presentational pieces so both prototypes render the identical tree.

import { memo, Profiler, useEffect, useReducer } from "react";
import { benchStats, counters } from "./bench";
import type { SpikeStatus, WireIssue } from "./types";

export const STATUS_LABELS: Record<SpikeStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

export const IssueCard = memo(function IssueCard({
  issue,
  prefix,
  onCardClick,
}: {
  issue: WireIssue;
  prefix: string;
  onCardClick: (id: string) => void;
}) {
  counters.cardRenders++;
  return (
    <li
      data-issue-id={issue.id}
      onClick={() => onCardClick(issue.id)}
      className="cursor-pointer rounded border border-stone-200 bg-white px-2 py-1 text-xs hover:border-stone-400"
    >
      <span className="font-mono text-stone-400">
        {prefix}-{issue.number}
      </span>{" "}
      <span>{issue.title}</span>
      <span className="ml-1 text-stone-400">
        {issue.priority}
        {issue.estimate !== null ? ` · ${issue.estimate}` : ""}
      </span>
    </li>
  );
});

export function BoardShell({ impl, children }: { impl: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 p-4 text-stone-900">
      <StatsBadge impl={impl} />
      <Profiler
        id={impl}
        onRender={(_id, _phase, actualDuration) => {
          counters.reactCommitMs += actualDuration;
        }}
      >
        <div className="flex gap-3 overflow-x-auto pt-14">{children}</div>
      </Profiler>
    </div>
  );
}

export function ColumnShell({
  status,
  count,
  children,
}: {
  status: SpikeStatus;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="w-72 shrink-0">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
        {STATUS_LABELS[status]} · {count}
      </h2>
      <ul className="space-y-1">{children}</ul>
    </section>
  );
}

// Polls the collectors on a timer — deliberately outside the board's render
// path so observing the stats doesn't perturb the measurement.
function StatsBadge({ impl }: { impl: string }) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const t = setInterval(bump, 500);
    return () => clearInterval(t);
  }, []);
  const s = benchStats();
  return (
    <div className="fixed left-4 top-4 z-10 rounded bg-stone-900 px-3 py-1.5 font-mono text-xs text-stone-100">
      {impl} · load {Math.round(s.load.fetchMs)}ms fetch + {Math.round(s.load.readyToPaintMs)}ms
      paint · {s.mutations} muts · p50 {s.clickToPaintMs.p50}ms p95 {s.clickToPaintMs.p95}ms ·{" "}
      {s.rendersPerMutation.cards} cards/{s.rendersPerMutation.columns} cols per mut
    </div>
  );
}
