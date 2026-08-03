// Diary logic (PROG-113): the pure, store-side half of the Diary view. The
// first wave of the page renders entirely from the snapshot — what finished,
// what was started, what else moved on a given local calendar day, plus the
// multi-day completion series behind the progress strip — so it paints
// instantly (SPEC §2.1). The server wave (activity/comments/git links) and the
// AI entry layer on top via the /api/diary endpoints.

import type { SnapshotPayload, WireAction } from "../shared/types";
import { addDays, localDayOfInstant } from "./dates";

// The epoch bounds (unix seconds) of a local calendar day: local midnight to
// the next local midnight. Built through the Date(y, m, d) constructor so a
// DST-shifted day (23h/25h) still spans exactly midnight-to-midnight.
export function dayBounds(day: string): { from: number; to: number } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const from = new Date(y, m - 1, d).getTime();
  const to = new Date(y, m - 1, d + 1).getTime();
  return { from: Math.floor(from / 1000), to: Math.floor(to / 1000) };
}

export type DayRecap = {
  // Reached `done` on this day (still done now — completedAt clears if it
  // reopens, so this is "finished as of today's knowledge", which is what a
  // diary read later should say).
  completed: WireAction[];
  // Born this day.
  created: WireAction[];
  // Everything else that moved this day (updatedAt) and isn't already listed —
  // the "worked on" pile.
  touched: WireAction[];
};

const onDay = (iso: string | null, day: string): boolean =>
  iso !== null && localDayOfInstant(iso) === day;

export function dayRecap(snapshot: SnapshotPayload, day: string): DayRecap {
  const completed: WireAction[] = [];
  const created: WireAction[] = [];
  const touched: WireAction[] = [];
  for (const action of snapshot.actions) {
    const isCompleted = onDay(action.completedAt, day);
    const isCreated = onDay(action.createdAt, day);
    if (isCompleted) completed.push(action);
    if (isCreated) created.push(action);
    if (!isCompleted && !isCreated && onDay(action.updatedAt, day)) touched.push(action);
  }
  const byRecency = (a: WireAction, b: WireAction) => b.updatedAt.localeCompare(a.updatedAt);
  completed.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  created.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  touched.sort(byRecency);
  return { completed, created, touched };
}

export type DayCount = { day: string; count: number };

// Completions per local day for the `days` days ending at `endDay` inclusive,
// oldest first — the progress strip's series. Days with nothing read as zero
// so the strip keeps its rhythm (a gap is information, not missing data).
export function completionSeries(
  snapshot: SnapshotPayload,
  endDay: string,
  days: number,
): DayCount[] {
  const counts = new Map<string, number>();
  for (const action of snapshot.actions) {
    if (!action.completedAt) continue;
    const day = localDayOfInstant(action.completedAt);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const series: DayCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(endDay, -i);
    series.push({ day, count: counts.get(day) ?? 0 });
  }
  return series;
}

// Long display form of a diary day ("Sunday, August 3"), parsed at UTC
// midnight and formatted in UTC so the calendar day never shifts (the
// formatDueDate convention).
export function formatDiaryDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
