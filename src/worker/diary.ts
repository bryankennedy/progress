// Diary helpers (PROG-113): pure logic behind GET /api/diary and
// GET /api/diary/summary. The route handlers in index.ts do the I/O (D1
// queries, the Anthropic call, the cache table); everything deterministic —
// window validation, the event digest the prompt is built from, and the
// prompt itself — lives here so it can be unit-tested without a Worker.

import type { Action, Activity, Comment, CommitLink, Focus, PrLink, User } from "../db/schema";

// The client computes the local-midnight epoch bounds of the day it wants
// (the server has no idea what timezone the owner is in) and sends them as
// unix seconds. Cap the span at 48h: a "day" plus DST slack — anything wider
// is a malformed or abusive request, not a diary day.
export const MAX_WINDOW_SECONDS = 48 * 3600;

export type DiaryWindow = { from: Date; to: Date };

// Parses and validates ?from=&to= (unix seconds). Null = invalid.
export function parseDiaryWindow(
  fromRaw: string | undefined,
  toRaw: string | undefined,
): DiaryWindow | null {
  if (!fromRaw || !toRaw) return null;
  if (!/^\d{1,12}$/.test(fromRaw) || !/^\d{1,12}$/.test(toRaw)) return null;
  const from = Number(fromRaw);
  const to = Number(toRaw);
  if (!(from < to) || to - from > MAX_WINDOW_SECONDS) return null;
  return { from: new Date(from * 1000), to: new Date(to * 1000) };
}

// A diary day is addressed as an ISO calendar day (the due-date convention).
export function isValidDiaryDay(day: string | undefined): day is string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return !Number.isNaN(Date.parse(`${day}T00:00:00.000Z`));
}

// Everything the digest (and therefore the prompt) is built from. The route
// gathers these; keys/titles come pre-resolved so this module never touches
// the database.
export type DiaryDayData = {
  day: string;
  activity: Activity[];
  comments: Comment[];
  pullRequests: PrLink[];
  commits: CommitLink[];
  // Actions created inside the window (creation writes no activity row).
  created: Action[];
  // Row lookups for phrasing digest lines.
  actionsById: Map<string, Action>;
  focusesById: Map<string, Focus>;
  usersById: Map<string, User>;
  // The viewer's UTC offset in minutes, as Date#getTimezoneOffset reports it
  // (positive = behind UTC), so digest times read in the owner's local clock.
  tzOffsetMinutes: number;
};

export function diaryKeyOf(
  action: Action | undefined,
  focusesById: Map<string, Focus>,
): string | null {
  if (!action) return null;
  const prefix = focusesById.get(action.focusId)?.keyPrefix;
  return prefix ? `${prefix}-${action.number}` : null;
}

function localClock(at: Date, tzOffsetMinutes: number): string {
  const shifted = new Date(at.getTime() - tzOffsetMinutes * 60_000);
  const h = String(shifted.getUTCHours()).padStart(2, "0");
  const m = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

// One deterministic line per event, chronological, stable across identical
// inputs — the digest doubles as the cache key material (SHA-256 in the
// route), so any nondeterminism here would defeat the summary cache.
export function diaryDigest(data: DiaryDayData): string {
  const { actionsById, focusesById, usersById, tzOffsetMinutes } = data;
  const ref = (actionId: string): string => {
    const action = actionsById.get(actionId);
    const key = diaryKeyOf(action, focusesById);
    if (!action) return actionId;
    return `${key ?? actionId} "${excerpt(action.title, 80)}"`;
  };
  const who = (userId: string): string => usersById.get(userId)?.name ?? "someone";

  const lines: { at: number; text: string }[] = [];

  for (const action of data.created) {
    lines.push({
      at: action.createdAt.getTime(),
      text: `${localClock(action.createdAt, tzOffsetMinutes)} — ${who(action.creatorId)} created ${ref(action.id)}`,
    });
  }
  for (const event of data.activity) {
    const at = event.createdAt;
    const base = `${localClock(at, tzOffsetMinutes)} — `;
    const d = (event.data ?? {}) as Record<string, unknown>;
    let text: string;
    switch (event.type) {
      case "status_changed":
        text = `${base}${who(event.actorId)} moved ${ref(event.actionId)} from ${String(d.from)} to ${String(d.to)}`;
        break;
      case "moved":
        text = `${base}${who(event.actorId)} moved ${ref(event.actionId)} to another focus`;
        break;
      case "pr_linked":
        text = `${base}PR #${String(d.prNumber)} "${excerpt(String(d.title ?? ""), 80)}" linked to ${ref(event.actionId)}`;
        break;
      case "commit_linked":
        text = `${base}commit "${excerpt(String(d.message ?? ""), 80)}" linked to ${ref(event.actionId)}`;
        break;
      default:
        text = `${base}${event.type} on ${ref(event.actionId)}`;
    }
    lines.push({ at: at.getTime(), text });
  }
  for (const comment of data.comments) {
    lines.push({
      at: comment.createdAt.getTime(),
      text: `${localClock(comment.createdAt, tzOffsetMinutes)} — ${who(comment.authorId)} commented on ${ref(comment.actionId)}: "${excerpt(comment.body)}"`,
    });
  }
  // PR state updates that happened inside the window without a fresh link
  // (merge/close update the row in place, D29). A row created in the window
  // already has its pr_linked activity line above.
  for (const pr of data.pullRequests) {
    if (pr.updatedAt.getTime() === pr.createdAt.getTime()) continue;
    lines.push({
      at: pr.updatedAt.getTime(),
      text: `${localClock(pr.updatedAt, tzOffsetMinutes)} — PR #${pr.prNumber} "${excerpt(pr.title, 80)}" on ${ref(pr.actionId)} is now ${pr.state}`,
    });
  }

  lines.sort((a, b) => a.at - b.at || a.text.localeCompare(b.text));
  return [`Day: ${data.day}`, ...lines.map((l) => l.text)].join("\n");
}

// The diary voice: a short, calm entry in the product's own register — plain
// prose, concrete, no bullet lists, no cheerleading. The model sees only the
// digest; everything it may mention is in there.
export const DIARY_SYSTEM_PROMPT = `You write the daily diary entry for Progress, a personal work tracker. You are given a chronological digest of one day's events: actions created, statuses changed, comments, commits, and pull requests. Actions are referenced as KEY "title".

Write one short diary entry for that day:
- One paragraph, 2–5 sentences, plain prose. No headings, no bullet points, no emoji, no exclamation marks.
- Calm and concrete. Lead with what actually got finished; then the meaningful movement. Mention action keys (like PROG-12) naturally where they help.
- Group related events rather than narrating every line; small housekeeping can be summarized or omitted.
- If the day was quiet, say so plainly in a sentence or two — never invent activity or pad.
- Write in past tense, third person neutral (no "you", no "I").

Reply with the entry text only.`;

// The model that writes entries. One constant so the cache rows and any future
// migration have a single source of truth.
export const DIARY_MODEL = "claude-opus-4-8";

export function diaryUserPrompt(digest: string): string {
  return `Here is the day's event digest:\n\n${digest}\n\nWrite the diary entry.`;
}

// SHA-256 hex of the digest — the cache-freshness key stored beside the
// summary. WebCrypto is available in Workers, Bun, and the browser alike.
export async function digestHash(digest: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(digest));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
