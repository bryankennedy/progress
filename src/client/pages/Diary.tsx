// The Diary view (PROG-113): a per-day recap of what actually happened. Three
// layers, honoring the instant-UI rule (SPEC §2.1):
//
//   1. Wave 1 — synchronous from the snapshot (./diary): what finished, what
//      was started, what else moved on the selected local day, plus the
//      five-week progress strip of completions per day.
//   2. Wave 2 — one background round-trip (GET /api/diary): the day's
//      cross-action activity, comments, and git links, which aren't in the
//      snapshot (D20). Streams into the "events" section a beat later — the
//      search page's comment-wave pattern.
//   3. The AI entry (GET /api/diary/summary): a short written recap of the
//      day, cached server-side by event digest so revisits are instant. When
//      the server has no ANTHROPIC_API_KEY the section quietly disappears.
//
// The day is addressed as ?date=YYYY-MM-DD (default: today) so any day is a
// bookmark; ‹ › and the progress strip navigate between days.

import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import type { DiaryDayPayload, SnapshotPayload, WireAction } from "../../shared/types";
import { closedTitleClass } from "../actionDone";
import { addDays, formatDueDate, todayISO } from "../dates";
import { completionSeries, dayBounds, dayRecap, formatDiaryDay } from "../diary";
import { STATUS_LABELS } from "../labels";
import StatusIndicator from "../StatusIndicator";
import { actionKeyOf, rewriteDiarySummary, useDiaryDay, useDiarySummary } from "../store";

// Five weeks of history in the strip — enough to see a rhythm, small enough
// to stay an inline glanceable.
const STRIP_DAYS = 35;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function Diary({ snapshot }: { snapshot: SnapshotPayload }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const today = todayISO();
  const dateParam = new URLSearchParams(search).get("date");
  const day = dateParam && DAY_RE.test(dateParam) ? dateParam : today;

  const bounds = useMemo(() => dayBounds(day), [day]);
  const recap = useMemo(() => dayRecap(snapshot, day), [snapshot, day]);
  const series = useMemo(() => completionSeries(snapshot, today, STRIP_DAYS), [snapshot, today]);

  const openDay = (d: string) => navigate(d === today ? "/diary" : `/diary?date=${d}`);

  const quiet =
    recap.completed.length === 0 && recap.created.length === 0 && recap.touched.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Diary</h1>
        <p className="text-xs text-ink-faint">
          {recap.completed.length} completed · {recap.created.length} started
          {day !== today && (
            <>
              {" · "}
              <button onClick={() => openDay(today)} className="underline hover:text-ink-soft">
                back to today
              </button>
            </>
          )}
        </p>
      </header>

      <ProgressStrip series={series} selected={day} onSelect={openDay} />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => openDay(addDays(day, -1))}
          aria-label="Previous day"
          className="rounded border border-line bg-card px-2 py-0.5 text-sm text-ink-soft hover:border-ink-faint"
        >
          ‹
        </button>
        <h2 className="whitespace-nowrap text-lg font-medium">{formatDiaryDay(day)}</h2>
        <button
          onClick={() => openDay(addDays(day, 1))}
          disabled={day >= today}
          aria-label="Next day"
          className="rounded border border-line bg-card px-2 py-0.5 text-sm text-ink-soft hover:border-ink-faint disabled:opacity-40 disabled:hover:border-line"
        >
          ›
        </button>
        <input
          type="date"
          value={day}
          max={today}
          onChange={(e) => {
            if (e.target.value) openDay(e.target.value);
          }}
          aria-label="Jump to a day"
          className="ml-auto rounded border border-line bg-card px-1.5 py-0.5 text-xs text-ink-soft hover:border-ink-faint"
        />
      </div>

      <DiaryEntry day={day} bounds={bounds} quiet={quiet} />

      {quiet ? (
        <p className="mt-6 text-sm text-ink-faint">
          Nothing recorded on this day — no actions finished, started, or touched.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          <RecapSection
            title="Completed"
            accent="text-moss-deep"
            actions={recap.completed}
            snapshot={snapshot}
          />
          <RecapSection
            title="Started"
            accent="text-ink"
            actions={recap.created}
            snapshot={snapshot}
          />
          <RecapSection
            title="Also touched"
            accent="text-ink-soft"
            actions={recap.touched}
            snapshot={snapshot}
          />
        </div>
      )}

      <DayEvents day={day} bounds={bounds} snapshot={snapshot} />
    </div>
  );
}

// ── Progress strip ───────────────────────────────────────────────────────────
// Completions per day for the last five weeks — one thin bar per day, moss
// (the completed color), the selected day in accent (the "now" accent). Every
// bar is a button that opens its day; zero days keep a hairline stub so the
// rhythm of the strip stays readable (a gap is information).
function ProgressStrip({
  series,
  selected,
  onSelect,
}: {
  series: { day: string; count: number }[];
  selected: string;
  onSelect: (day: string) => void;
}) {
  const max = Math.max(1, ...series.map((d) => d.count));
  return (
    <div className="mt-4">
      <div
        role="group"
        aria-label={`Completed actions per day, last ${series.length} days`}
        className="flex h-14 items-end gap-[2px] rounded-lg border border-line bg-card px-2 pt-2"
      >
        {series.map(({ day, count }) => {
          const isSelected = day === selected;
          return (
            <button
              key={day}
              onClick={() => onSelect(day)}
              title={`${formatDueDate(day)} — ${count} completed`}
              aria-label={`${formatDueDate(day)} — ${count} completed`}
              aria-pressed={isSelected}
              className="group flex h-full flex-1 items-end justify-center"
            >
              <span
                aria-hidden
                style={{ height: count === 0 ? "2px" : `${Math.max(12, (count / max) * 100)}%` }}
                className={`w-full max-w-2.5 rounded-t-[3px] ${
                  isSelected
                    ? "bg-accent"
                    : count === 0
                      ? "bg-line group-hover:bg-ink-faint"
                      : "bg-moss group-hover:bg-moss-deep"
                }`}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between px-1 font-mono text-[11px] text-ink-faint">
        <span>{formatDueDate(series[0]!.day)}</span>
        <span>
          {formatDueDate(selected)} · {series.find((d) => d.day === selected)?.count ?? 0} completed
        </span>
        <span>{formatDueDate(series[series.length - 1]!.day)}</span>
      </div>
    </div>
  );
}

// ── The AI entry ─────────────────────────────────────────────────────────────
function DiaryEntry({
  day,
  bounds,
  quiet,
}: {
  day: string;
  bounds: { from: number; to: number };
  quiet: boolean;
}) {
  const { data, isPending, isError } = useDiarySummary(day, bounds);
  const [rewriting, setRewriting] = useState(false);

  // Key not configured: the diary simply has no written entry — say nothing.
  if (data?.unavailable) return null;
  // A quiet day needs no model to tell us so; the empty state below covers it.
  if (data && data.summary === null) return null;
  if (quiet && !data?.summary) return null;

  return (
    <div className="mt-4 rounded-lg border border-line bg-card px-4 py-3">
      {isPending || rewriting ? (
        <p className="animate-pulse text-sm italic text-ink-faint">Writing the day's entry…</p>
      ) : isError ? (
        <p className="text-sm text-ink-faint">The day's entry couldn't be written just now.</p>
      ) : (
        <>
          <p className="text-[15px] leading-relaxed text-ink">{data!.summary}</p>
          <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-ink-faint">
            <span>the day, in short</span>
            <button
              onClick={async () => {
                setRewriting(true);
                await rewriteDiarySummary(day, bounds);
                setRewriting(false);
              }}
              title="Rewrite the entry from today's events"
              className="hover:text-ink-soft"
            >
              ↻ rewrite
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Wave-1 recap sections ────────────────────────────────────────────────────
function RecapSection({
  title,
  accent,
  actions,
  snapshot,
}: {
  title: string;
  accent: string;
  actions: WireAction[];
  snapshot: SnapshotPayload;
}) {
  if (actions.length === 0) return null;
  return (
    <section>
      <h3 className={`font-mono text-sm font-medium uppercase tracking-wide ${accent}`}>
        {title} · {actions.length}
      </h3>
      <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-card">
        {actions.map((action) => {
          const key = actionKeyOf(snapshot, action);
          const focus = snapshot.focuses.find((f) => f.id === action.focusId);
          return (
            <li key={action.id} data-action-id={action.id} className="px-3 py-2 text-sm">
              <div className="flex items-center gap-2.5">
                <StatusIndicator status={action.status} className="h-4 w-4 shrink-0" />
                <Link
                  href={`/action/${key}`}
                  className="shrink-0 font-mono text-xs text-ink-faint hover:text-ink-soft"
                >
                  {key}
                </Link>
                <Link
                  href={`/action/${key}`}
                  className={`min-w-0 flex-1 truncate font-medium hover:text-accent-deep ${closedTitleClass(action.status)}`}
                >
                  {action.title}
                </Link>
                <span className="hidden shrink-0 text-xs text-ink-faint sm:inline">
                  {focus?.name}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Wave-2: the day's events ─────────────────────────────────────────────────
type EventItem = { at: string; id: string; body: React.ReactNode };

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function buildEvents(payload: DiaryDayPayload, snapshot: SnapshotPayload): EventItem[] {
  const actionsById = new Map(snapshot.actions.map((a) => [a.id, a]));
  const usersById = new Map(snapshot.users.map((u) => [u.id, u]));

  const keyLink = (actionId: string) => {
    const action = actionsById.get(actionId);
    if (!action) return <span className="font-mono text-xs">{actionId}</span>;
    const key = actionKeyOf(snapshot, action);
    return (
      <Link
        href={`/action/${key}`}
        title={action.title}
        className="font-mono text-xs text-accent hover:text-accent-deep"
      >
        {key}
      </Link>
    );
  };
  const titleOf = (actionId: string) => actionsById.get(actionId)?.title ?? "";
  const who = (userId: string) => usersById.get(userId)?.name ?? "someone";

  const items: EventItem[] = [];

  for (const event of payload.activity) {
    // Git-link activity is skipped here — the link rows below carry the same
    // moment with more detail (URL, state), so keeping both would double up.
    if (event.type === "pr_linked" || event.type === "commit_linked") continue;
    const d = (event.data ?? {}) as { from?: string; to?: string };
    items.push({
      at: event.createdAt,
      id: event.id,
      body:
        event.type === "status_changed" ? (
          <>
            {who(event.actorId)} moved {keyLink(event.actionId)} {titleOf(event.actionId)}{" "}
            <span className="whitespace-nowrap text-ink-soft">
              → {STATUS_LABELS[(d.to ?? "todo") as keyof typeof STATUS_LABELS] ?? d.to}
            </span>
          </>
        ) : event.type === "moved" ? (
          <>
            {who(event.actorId)} moved {keyLink(event.actionId)} to another focus
          </>
        ) : (
          <>
            {event.type} on {keyLink(event.actionId)}
          </>
        ),
    });
  }
  for (const comment of payload.comments) {
    items.push({
      at: comment.createdAt,
      id: comment.id,
      body: (
        <>
          {who(comment.authorId)} commented on {keyLink(comment.actionId)}
          <span className="mt-0.5 line-clamp-2 block text-ink-soft">{comment.body}</span>
        </>
      ),
    });
  }
  for (const commit of payload.commits) {
    items.push({
      at: commit.createdAt,
      id: `${commit.actionId}:${commit.sha}`,
      body: (
        <>
          commit{" "}
          <a
            href={commit.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-accent hover:text-accent-deep"
          >
            {commit.sha.slice(0, 7)}
          </a>{" "}
          on {keyLink(commit.actionId)} — <span className="text-ink-soft">{commit.message}</span>
        </>
      ),
    });
  }
  for (const pr of payload.pullRequests) {
    // A row can enter the window by being linked (createdAt) or by a state
    // change (updatedAt — merges update in place, D29). Phrase whichever
    // happened; both did = one line, the state is the news.
    const linkedNow = pr.createdAt === pr.updatedAt;
    items.push({
      at: pr.updatedAt,
      id: `${pr.actionId}:${pr.githubRepo}#${pr.prNumber}`,
      body: (
        <>
          PR{" "}
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-accent hover:text-accent-deep"
          >
            #{pr.prNumber}
          </a>{" "}
          {linkedNow ? "linked to" : `${pr.state} on`} {keyLink(pr.actionId)} —{" "}
          <span className="text-ink-soft">{pr.title}</span>
        </>
      ),
    });
  }

  return items.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

function DayEvents({
  day,
  bounds,
  snapshot,
}: {
  day: string;
  bounds: { from: number; to: number };
  snapshot: SnapshotPayload;
}) {
  const { data, isPending, isError } = useDiaryDay(day, bounds);
  const items = useMemo(() => (data ? buildEvents(data, snapshot) : []), [data, snapshot]);

  if (isError) return null;
  if (!isPending && items.length === 0) return null;

  return (
    <section className="mt-6">
      <h3 className="font-mono text-sm font-medium uppercase tracking-wide text-ink-soft">
        The day's events{!isPending && <> · {items.length}</>}
      </h3>
      {isPending ? (
        <p className="mt-2 text-sm text-ink-faint">Loading the day's events…</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-card">
          {items.map((item) => (
            <li key={item.id} className="flex gap-3 px-3 py-2 text-sm">
              <span className="shrink-0 pt-px font-mono text-xs text-ink-faint">
                {clock(item.at)}
              </span>
              <span className="min-w-0 flex-1">{item.body}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
