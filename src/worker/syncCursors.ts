// Change cursors for background sync (PROG-128). The client store loads the
// whole snapshot once and never refetches on its own (SPEC §8.2) — an
// assumption that broke once agent sessions started writing through the same
// API. Rather than re-shipping the full payload to find out nothing changed,
// the client polls these two opaque strings and refetches only when one moves.
//
// Each cursor concatenates per-table aggregates: row count plus max
// `updated_at` where the table has one (count catches creates/deletes, the
// timestamp catches edits). Append-only tables (tags, links, aliases,
// activity) contribute their count alone. Timestamps are epoch seconds, so
// two edits to the same row within one second can collide — accepted: the
// window is tiny at this scale and any later write re-moves the cursor.

import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import {
  actions,
  actionKeyAliases,
  actionTags,
  activity,
  allowedEmails,
  arcs,
  comments,
  commitLinks,
  focuses,
  prLinks,
  tags,
  users,
  workspaces,
} from "../db/schema";
import type { SyncCursors } from "../shared/types";

export type SyncCursorRow = {
  users_n: number;
  workspaces_n: number;
  workspaces_t: number | null;
  focuses_n: number;
  focuses_t: number | null;
  arcs_n: number;
  arcs_t: number | null;
  actions_n: number;
  actions_t: number | null;
  tags_n: number;
  action_tags_n: number;
  aliases_n: number;
  allowed_n: number;
  comments_n: number;
  comments_t: number | null;
  activity_n: number;
  pr_links_n: number;
  pr_links_t: number | null;
  commit_links_n: number;
};

// Pure: aggregates → cursor strings. `n.t` per table (t omitted for
// append-only tables, 0 when the table is empty), pipe-joined in a fixed
// order. The client only ever compares these for equality.
export function buildSyncCursors(row: SyncCursorRow): SyncCursors {
  const stamped = (n: number, t: number | null) => `${n}.${t ?? 0}`;
  return {
    snapshot: [
      `${row.users_n}`,
      stamped(row.workspaces_n, row.workspaces_t),
      stamped(row.focuses_n, row.focuses_t),
      stamped(row.arcs_n, row.arcs_t),
      stamped(row.actions_n, row.actions_t),
      `${row.tags_n}`,
      `${row.action_tags_n}`,
      `${row.aliases_n}`,
      `${row.allowed_n}`,
    ].join("|"),
    timeline: [
      stamped(row.comments_n, row.comments_t),
      `${row.activity_n}`,
      stamped(row.pr_links_n, row.pr_links_t),
      `${row.commit_links_n}`,
    ].join("|"),
  };
}

// One round trip: every aggregate is a scalar subquery of a single SELECT.
// All tables are small (the snapshot ships them whole), so the scans are
// microseconds — this is what makes polling cheap enough to run every minute.
export async function computeSyncCursors(db: DrizzleD1Database): Promise<SyncCursors> {
  const row = await db.get<SyncCursorRow>(sql`select
    (select count(*) from ${users}) as users_n,
    (select count(*) from ${workspaces}) as workspaces_n,
    (select max(updated_at) from ${workspaces}) as workspaces_t,
    (select count(*) from ${focuses}) as focuses_n,
    (select max(updated_at) from ${focuses}) as focuses_t,
    (select count(*) from ${arcs}) as arcs_n,
    (select max(updated_at) from ${arcs}) as arcs_t,
    (select count(*) from ${actions}) as actions_n,
    (select max(updated_at) from ${actions}) as actions_t,
    (select count(*) from ${tags}) as tags_n,
    (select count(*) from ${actionTags}) as action_tags_n,
    (select count(*) from ${actionKeyAliases}) as aliases_n,
    (select count(*) from ${allowedEmails}) as allowed_n,
    (select count(*) from ${comments}) as comments_n,
    (select max(updated_at) from ${comments}) as comments_t,
    (select count(*) from ${activity}) as activity_n,
    (select count(*) from ${prLinks}) as pr_links_n,
    (select max(updated_at) from ${prLinks}) as pr_links_t,
    (select count(*) from ${commitLinks}) as commit_links_n`);
  return buildSyncCursors(row);
}
