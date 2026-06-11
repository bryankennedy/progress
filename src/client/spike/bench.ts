// Measurement harness for the latency spike. Module-level collectors so the
// two prototypes share identical instrumentation.

import { useEffect } from "react";

export const counters = { cardRenders: 0, columnRenders: 0, reactCommitMs: 0 };

export const loadTiming = { fetchMs: 0, readyToPaintMs: 0 };

type MutationSample = {
  ms: number;
  cardRenders: number;
  columnRenders: number;
  reactMs: number;
};
const samples: MutationSample[] = [];

// Double-rAF approximates "the frame after this one painted" — the closest
// browser signal to click-to-paint without a real input pipeline.
export function doubleRaf(cb: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

// Call at the moment a mutation is triggered, BEFORE the optimistic write.
export function recordMutationStart() {
  const start = performance.now();
  const cards = counters.cardRenders;
  const columns = counters.columnRenders;
  const react = counters.reactCommitMs;
  doubleRaf(() => {
    samples.push({
      ms: performance.now() - start,
      cardRenders: counters.cardRenders - cards,
      columnRenders: counters.columnRenders - columns,
      reactMs: counters.reactCommitMs - react,
    });
  });
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

export function benchStats() {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    load: { ...loadTiming },
    mutations: samples.length,
    clickToPaintMs: {
      avg: round(avg(ms)),
      p50: round(percentile(ms, 50)),
      p95: round(percentile(ms, 95)),
      max: round(percentile(ms, 100)),
    },
    rendersPerMutation: {
      cards: round(avg(samples.map((s) => s.cardRenders))),
      columns: round(avg(samples.map((s) => s.columnRenders))),
      reactMs: round(avg(samples.map((s) => s.reactMs))),
    },
  };
}
const round = (n: number) => Math.round(n * 10) / 10;

// Deterministic PRNG so both prototypes mutate the same issue sequence.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForSamples(count: number) {
  while (samples.length < count) await sleep(10);
}

// With ?bench=N, runs N random status-cycles after load settles, then dumps
// results JSON into <pre id="bench-results"> and flags the title — readable
// by an automated browser without clicking anything.
export function useBenchRunner(
  impl: string,
  ready: boolean,
  getIds: () => string[],
  mutate: (id: string) => void,
) {
  useEffect(() => {
    if (!ready) return;
    const n = Number(new URLSearchParams(location.search).get("bench") ?? "0");
    if (!n) return;
    let cancelled = false;
    const rand = mulberry32(42);
    (async () => {
      await sleep(1500);
      const ids = getIds();
      for (let i = 0; i < n && !cancelled; i++) {
        // Dispatch a real DOM click so both prototypes go through React's
        // event batching exactly like a user interaction; fall back to the
        // direct call if the card isn't in the DOM.
        const id = ids[Math.floor(rand() * ids.length)]!;
        const el = document.querySelector<HTMLElement>(`[data-issue-id="${id}"]`);
        if (el) el.click();
        else mutate(id);
        // One mutation in flight at a time: wait for its paint sample to land
        // so measurements never overlap, then idle briefly.
        await waitForSamples(i + 1);
        await sleep(50);
      }
      await sleep(500);
      if (cancelled) return;
      const pre = document.createElement("pre");
      pre.id = "bench-results";
      pre.textContent = JSON.stringify({ impl, ...benchStats() }, null, 2);
      document.body.appendChild(pre);
      document.title = `BENCH DONE ${impl}`;
    })();
    return () => {
      cancelled = true;
    };
  }, [impl, ready, getIds, mutate]);
}
