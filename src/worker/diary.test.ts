import { describe, expect, test } from "bun:test";
import type { Action, Activity, Comment, Focus, PrLink, User } from "../db/schema";
import {
  diaryDigest,
  digestHash,
  isValidDiaryDay,
  MAX_WINDOW_SECONDS,
  parseDiaryWindow,
  type DiaryDayData,
} from "./diary";

describe("parseDiaryWindow", () => {
  test("accepts a sane day window", () => {
    const w = parseDiaryWindow("1754200800", "1754287200")!;
    expect(w.from.getTime()).toBe(1754200800_000);
    expect(w.to.getTime()).toBe(1754287200_000);
  });

  test("rejects missing, malformed, inverted, and oversized windows", () => {
    expect(parseDiaryWindow(undefined, "10")).toBeNull();
    expect(parseDiaryWindow("10", undefined)).toBeNull();
    expect(parseDiaryWindow("abc", "10")).toBeNull();
    expect(parseDiaryWindow("-5", "10")).toBeNull();
    expect(parseDiaryWindow("10", "10")).toBeNull();
    expect(parseDiaryWindow("20", "10")).toBeNull();
    expect(parseDiaryWindow("0", String(MAX_WINDOW_SECONDS + 1))).toBeNull();
    expect(parseDiaryWindow("0", String(MAX_WINDOW_SECONDS))).not.toBeNull();
  });
});

describe("isValidDiaryDay", () => {
  test("accepts ISO days, rejects everything else", () => {
    expect(isValidDiaryDay("2026-08-03")).toBe(true);
    expect(isValidDiaryDay("2026-13-03")).toBe(false);
    expect(isValidDiaryDay("20260803")).toBe(false);
    expect(isValidDiaryDay("2026-08-03T00:00:00Z")).toBe(false);
    expect(isValidDiaryDay(undefined)).toBe(false);
  });
});

// ── digest fixtures ──────────────────────────────────────────────────────────

const at = (iso: string) => new Date(iso);

const user = {
  id: "usr_1",
  name: "Bryan",
  email: "b@x",
  createdAt: at("2026-01-01T00:00:00Z"),
} as User;
const focus = { id: "foc_1", keyPrefix: "PROG" } as Focus;
const actionRow = (id: string, number: number, title: string): Action =>
  ({
    id,
    focusId: "foc_1",
    number,
    title,
    creatorId: "usr_1",
    createdAt: at("2026-08-03T14:00:00Z"),
    updatedAt: at("2026-08-03T14:00:00Z"),
  }) as Action;

function baseData(over: Partial<DiaryDayData> = {}): DiaryDayData {
  const a1 = actionRow("acn_1", 113, "Daily diary view");
  return {
    day: "2026-08-03",
    activity: [],
    comments: [],
    pullRequests: [],
    commits: [],
    created: [],
    actionsById: new Map([[a1.id, a1]]),
    focusesById: new Map([[focus.id, focus]]),
    usersById: new Map([[user.id, user]]),
    tzOffsetMinutes: 0,
    ...over,
  };
}

describe("diaryDigest", () => {
  test("an empty day is just the header line", () => {
    expect(diaryDigest(baseData())).toBe("Day: 2026-08-03");
  });

  test("phrases events chronologically with keys, names, and local clock", () => {
    const digest = diaryDigest(
      baseData({
        created: [actionRow("acn_1", 113, "Daily diary view")],
        activity: [
          {
            id: "act_1",
            actionId: "acn_1",
            actorId: "usr_1",
            type: "status_changed",
            data: { from: "todo", to: "done" },
            createdAt: at("2026-08-03T16:30:00Z"),
          } as Activity,
        ],
        comments: [
          {
            id: "cmt_1",
            actionId: "acn_1",
            authorId: "usr_1",
            body: "Shipped the first cut.",
            createdAt: at("2026-08-03T15:00:00Z"),
            updatedAt: at("2026-08-03T15:00:00Z"),
          } as Comment,
        ],
      }),
    );
    const lines = digest.split("\n");
    expect(lines[0]).toBe("Day: 2026-08-03");
    expect(lines[1]).toContain('14:00 — Bryan created PROG-113 "Daily diary view"');
    expect(lines[2]).toContain(
      '15:00 — Bryan commented on PROG-113 "Daily diary view": "Shipped the first cut."',
    );
    expect(lines[3]).toContain("16:30 — Bryan moved PROG-113");
    expect(lines[3]).toContain("from todo to done");
  });

  test("tz offset shifts the phrased clock, not the events", () => {
    const data = baseData({
      created: [actionRow("acn_1", 113, "Daily diary view")],
      // 300 = UTC-5 (getTimezoneOffset semantics: positive is behind UTC).
      tzOffsetMinutes: 300,
    });
    expect(diaryDigest(data)).toContain("09:00 — Bryan created");
  });

  test("a PR state change without a fresh link gets its own line", () => {
    const digest = diaryDigest(
      baseData({
        pullRequests: [
          {
            actionId: "acn_1",
            githubRepo: "o/r",
            prNumber: 42,
            title: "Add the diary",
            state: "merged",
            url: "https://x",
            createdAt: at("2026-08-01T10:00:00Z"),
            updatedAt: at("2026-08-03T18:00:00Z"),
          } as PrLink,
        ],
      }),
    );
    expect(digest).toContain(
      '18:00 — PR #42 "Add the diary" on PROG-113 "Daily diary view" is now merged',
    );
  });

  test("is deterministic for identical inputs", async () => {
    const make = () =>
      diaryDigest(
        baseData({
          created: [actionRow("acn_1", 113, "Daily diary view")],
        }),
      );
    expect(make()).toBe(make());
    expect(await digestHash(make())).toBe(await digestHash(make()));
  });
});

describe("digestHash", () => {
  test("sha-256 hex, sensitive to any change", async () => {
    const a = await digestHash("Day: 2026-08-03");
    const b = await digestHash("Day: 2026-08-04");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
