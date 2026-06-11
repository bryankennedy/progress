// TanStack Query prototype: one ['workspace'] query is the whole store.
// Columns select their slice from the cache; the optimistic write follows the
// idiomatic setQueryData-snapshot-rollback pattern. Structural sharing
// preserves untouched issue refs, so memo'd cards skip.

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { memo, useCallback } from "react";
import { counters, doubleRaf, loadTiming, recordMutationStart, useBenchRunner } from "./bench";
import {
  fetchWorkspace,
  nextStatus,
  patchStatus,
  SPIKE_STATUSES,
  type SpikeStatus,
  type WireWorkspace,
} from "./types";
import { BoardShell, ColumnShell, IssueCard } from "./ui";

const WS_KEY = ["workspace"];

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false },
  },
});

async function timedFetch(): Promise<WireWorkspace> {
  const t0 = performance.now();
  const ws = await fetchWorkspace();
  loadTiming.fetchMs = performance.now() - t0;
  const t1 = performance.now();
  doubleRaf(() => {
    loadTiming.readyToPaintMs = performance.now() - t1;
  });
  return ws;
}

function cycleStatusOptimistic(qc: ReturnType<typeof useQueryClient>, id: string) {
  const ws = qc.getQueryData<WireWorkspace>(WS_KEY);
  const issue = ws?.issues.find((i) => i.id === id);
  if (!ws || !issue) return;
  const from = issue.status;
  const to = nextStatus(from);

  recordMutationStart();
  const setStatus = (status: SpikeStatus) =>
    qc.setQueryData<WireWorkspace>(WS_KEY, (cur) =>
      cur
        ? { ...cur, issues: cur.issues.map((i) => (i.id === id ? { ...i, status } : i)) }
        : cur,
    );
  setStatus(to);
  void patchStatus(id, to).then((ok) => {
    if (!ok) setStatus(from);
  });
}

export default function QuerySpike() {
  return (
    <QueryClientProvider client={queryClient}>
      <Board />
    </QueryClientProvider>
  );
}

function Board() {
  const qc = useQueryClient();
  // Subscribe only to `products` (stable ref under structural sharing) so the
  // board shell doesn't re-render on every issue write.
  const { data: products } = useQuery({
    queryKey: WS_KEY,
    queryFn: timedFetch,
    select: useCallback((ws: WireWorkspace) => ws.products, []),
  });

  const onCardClick = useCallback((id: string) => cycleStatusOptimistic(qc, id), [qc]);
  const getIds = useCallback(
    () => (qc.getQueryData<WireWorkspace>(WS_KEY)?.issues ?? []).map((i) => i.id),
    [qc],
  );
  useBenchRunner("query", products !== undefined, getIds, onCardClick);

  const prefixes = new Map((products ?? []).map((p) => [p.id, p.keyPrefix]));

  return (
    <BoardShell impl="query">
      {products ? (
        SPIKE_STATUSES.map((status) => (
          <Column key={status} status={status} prefixes={prefixes} onCardClick={onCardClick} />
        ))
      ) : (
        <p className="text-stone-400">Loading workspace…</p>
      )}
    </BoardShell>
  );
}

const Column = memo(
  function Column({
    status,
    prefixes,
    onCardClick,
  }: {
    status: SpikeStatus;
    prefixes: Map<string, string>;
    onCardClick: (id: string) => void;
  }) {
    counters.columnRenders++;
    const select = useCallback(
      (ws: WireWorkspace) =>
        ws.issues.filter((i) => i.status === status).sort((a, b) => a.number - b.number),
      [status],
    );
    const { data: issues } = useQuery({ queryKey: WS_KEY, queryFn: timedFetch, select });
    return (
      <ColumnShell status={status} count={issues?.length ?? 0}>
        {(issues ?? []).map((issue) => (
          <IssueCard
            key={issue.id}
            issue={issue}
            prefix={prefixes.get(issue.productId) ?? "?"}
            onCardClick={onCardClick}
          />
        ))}
      </ColumnShell>
    );
  },
  // prefixes is rebuilt per Board render but content-stable; compare cheaply.
  (a, b) => a.status === b.status && a.onCardClick === b.onCardClick,
);
