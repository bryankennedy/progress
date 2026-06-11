import { memo, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { counters, doubleRaf, loadTiming, recordMutationStart, useBenchRunner } from "./bench";
import { SpikeStore } from "./store";
import { fetchWorkspace, SPIKE_STATUSES, type SpikeStatus } from "./types";
import { BoardShell, ColumnShell, IssueCard } from "./ui";

export default function BespokeSpike() {
  const [store] = useState(() => new SpikeStore());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t0 = performance.now();
    void fetchWorkspace().then((ws) => {
      loadTiming.fetchMs = performance.now() - t0;
      store.load(ws);
      const t1 = performance.now();
      setReady(true);
      doubleRaf(() => {
        loadTiming.readyToPaintMs = performance.now() - t1;
      });
    });
  }, [store]);

  const onCardClick = useCallback(
    (id: string) => {
      recordMutationStart();
      store.cycleStatus(id);
    },
    [store],
  );
  const getIds = useCallback(() => store.issueIds, [store]);
  useBenchRunner("bespoke", ready, getIds, onCardClick);

  return (
    <BoardShell impl="bespoke">
      {ready ? (
        SPIKE_STATUSES.map((status) => (
          <Column key={status} status={status} store={store} onCardClick={onCardClick} />
        ))
      ) : (
        <p className="text-stone-400">Loading workspace…</p>
      )}
    </BoardShell>
  );
}

const Column = memo(function Column({
  status,
  store,
  onCardClick,
}: {
  status: SpikeStatus;
  store: SpikeStore;
  onCardClick: (id: string) => void;
}) {
  counters.columnRenders++;
  const subscribe = useCallback(
    (cb: () => void) => store.subscribeColumn(status, cb),
    [store, status],
  );
  const ids = useSyncExternalStore(subscribe, () => store.getColumn(status));
  return (
    <ColumnShell status={status} count={ids.length}>
      {ids.map((id) => (
        <Card key={id} id={id} store={store} onCardClick={onCardClick} />
      ))}
    </ColumnShell>
  );
});

const Card = memo(function Card({
  id,
  store,
  onCardClick,
}: {
  id: string;
  store: SpikeStore;
  onCardClick: (id: string) => void;
}) {
  const subscribe = useCallback((cb: () => void) => store.subscribeIssue(id, cb), [store, id]);
  const issue = useSyncExternalStore(subscribe, () => store.getIssue(id));
  return (
    <IssueCard
      issue={issue}
      prefix={store.prefixes.get(issue.productId) ?? "?"}
      onCardClick={onCardClick}
    />
  );
});
