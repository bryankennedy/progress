// Tests for the change-cursor builder (PROG-128). Run with `bun test`. The
// SQL half is a single aggregate SELECT; what matters here is that the pure
// builder moves the cursor for every kind of change the snapshot/timeline can
// see, and only the half that changed.
import { describe, expect, it } from "bun:test";
import { buildSyncCursors, type SyncCursorRow } from "./syncCursors";

const base: SyncCursorRow = {
  users_n: 1,
  workspaces_n: 2,
  workspaces_t: 100,
  focuses_n: 3,
  focuses_t: 200,
  arcs_n: 4,
  arcs_t: 300,
  actions_n: 50,
  actions_t: 400,
  tags_n: 5,
  action_tags_n: 12,
  aliases_n: 2,
  allowed_n: 3,
  comments_n: 40,
  comments_t: 500,
  activity_n: 90,
  pr_links_n: 6,
  pr_links_t: 600,
  commit_links_n: 7,
};

describe("buildSyncCursors", () => {
  it("is deterministic for identical aggregates", () => {
    expect(buildSyncCursors(base)).toEqual(buildSyncCursors({ ...base }));
  });

  it("treats empty-table max timestamps (null) as stable zeros", () => {
    const empty = buildSyncCursors({ ...base, actions_n: 0, actions_t: null });
    expect(empty).toEqual(buildSyncCursors({ ...base, actions_n: 0, actions_t: null }));
    expect(empty.snapshot).not.toBe(buildSyncCursors(base).snapshot);
  });

  it("moves the snapshot cursor for creates, edits, and deletes", () => {
    const { snapshot } = buildSyncCursors(base);
    // Create/delete: count moves.
    expect(buildSyncCursors({ ...base, actions_n: 51 }).snapshot).not.toBe(snapshot);
    // Edit: max(updated_at) moves.
    expect(buildSyncCursors({ ...base, actions_t: 401 }).snapshot).not.toBe(snapshot);
    // Append-only tables move via count alone.
    expect(buildSyncCursors({ ...base, action_tags_n: 13 }).snapshot).not.toBe(snapshot);
    expect(buildSyncCursors({ ...base, aliases_n: 3 }).snapshot).not.toBe(snapshot);
  });

  it("keeps the two cursors independent", () => {
    const original = buildSyncCursors(base);
    const commentPosted = buildSyncCursors({ ...base, comments_n: 41, comments_t: 501 });
    expect(commentPosted.snapshot).toBe(original.snapshot);
    expect(commentPosted.timeline).not.toBe(original.timeline);

    const actionEdited = buildSyncCursors({ ...base, actions_t: 401 });
    expect(actionEdited.timeline).toBe(original.timeline);
    expect(actionEdited.snapshot).not.toBe(original.snapshot);
  });

  it("cannot collide across adjacent fields (delimited, not concatenated)", () => {
    // 2 workspaces + count-3 focuses vs 23 workspaces … — delimiter keeps
    // these distinct even when digit runs would otherwise merge.
    const a = buildSyncCursors({ ...base, workspaces_n: 2, focuses_n: 3 });
    const b = buildSyncCursors({ ...base, workspaces_n: 23, focuses_n: 3 });
    expect(a.snapshot).not.toBe(b.snapshot);
  });
});
