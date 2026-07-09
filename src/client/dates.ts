// Due dates are wall-calendar days (SPEC v2 §5): an ISO `YYYY-MM-DD` string,
// the same day everywhere, NOT an instant. All the Agenda's bucketing, sorting
// and relative phrasing run here, client-side, from the snapshot payload
// (SPEC v2 §7.1 / §10) — there is no server-side date logic.
//
// Buckets are computed against the owner's *local* "today" (a due date is a
// calendar day, so the relevant "now" is wherever the app is open). "This
// week" is a rolling 7 days (DECISIONS D38).

// A Date's local calendar day as `YYYY-MM-DD`. Uses local getters (not
// toISOString, which is UTC) so the day flips at the user's local midnight.
function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Today's local calendar day as `YYYY-MM-DD`.
export function todayISO(): string {
  return localDay(new Date());
}

// The local calendar day an ISO *instant* (a full timestamp like `updatedAt`)
// fell on — the bridge from row timestamps to the calendar-day helpers below
// (PROG-96: the search page phrases "updated" relative to today).
export function localDayOfInstant(iso: string): string {
  return localDay(new Date(iso));
}

// Whole-day signed difference between two `YYYY-MM-DD` days (b − a), computed
// at UTC midnight so DST never adds/drops an hour. Positive = `b` is later.
export function dayDiff(a: string, b: string): number {
  const ams = Date.parse(`${a}T00:00:00.000Z`);
  const bms = Date.parse(`${b}T00:00:00.000Z`);
  return Math.round((bms - ams) / 86_400_000);
}

// `iso` shifted by `n` whole days, returned as `YYYY-MM-DD`. Computed at UTC
// midnight (calendar-day math, DST-safe), matching dayDiff.
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export type AgendaBucket = "overdue" | "today" | "week" | "later";

// Which Agenda group a due date falls into, relative to local `today`.
// Overdue = strictly before today; Today = today; This week = the next 6 days
// (rolling 7-day window including today's neighbors); Later = beyond that.
export function bucketOf(due: string, today: string): AgendaBucket {
  const diff = dayDiff(today, due);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 6) return "week";
  return "later";
}

// Human relative phrase for a due date ("today", "tomorrow", "in 3 days",
// "2 days ago", "3 weeks ago") relative to local `today`.
export function relativeDue(due: string, today: string): string {
  const diff = dayDiff(today, due);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  const ahead = diff > 0;
  const n = Math.abs(diff);
  const unit =
    n < 7
      ? [n, "day"]
      : n < 30
        ? [Math.round(n / 7), "week"]
        : n < 365
          ? [Math.round(n / 30), "month"]
          : [Math.round(n / 365), "year"];
  const count = unit[0] as number;
  const word = `${unit[1]}${count === 1 ? "" : "s"}`;
  return ahead ? `in ${count} ${word}` : `${count} ${word} ago`;
}

// Short, locale-aware display of a `YYYY-MM-DD` day (e.g. "Jul 1"). Parsed at
// UTC midnight and formatted in UTC so the calendar day never shifts.
export function formatDueDate(due: string): string {
  return new Date(`${due}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
