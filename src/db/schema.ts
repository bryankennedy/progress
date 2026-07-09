import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// All IDs are app-generated text with a type prefix (usr_, wsp_, foc_, rep_,
// arc_, acn_, tag_, cmt_, act_) so any id is identifiable on sight in logs
// and URLs. Timestamps are unix-epoch integers set by the API (seeds use
// unixepoch()).

// Fixed vocabularies live in src/shared/constants.ts (shared with the
// client); re-exported here so DB-adjacent code keeps one import site.
import { ACTION_PRIORITIES, ACTION_STATUSES, PR_STATES } from "../shared/constants";
import { DEFAULT_RANK } from "../shared/rank";

export {
  ACTION_ESTIMATES,
  ACTION_PRIORITIES,
  ACTION_STATUSES,
  PR_STATES,
} from "../shared/constants";
export type { ActionPriority, ActionStatus, PrState } from "../shared/constants";

// Multi-user-ready from day one (SPEC §8.4, D13): one row in v1, but
// creator/assignee/author foreign keys point here.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // Manual outline order (PROG-87), same fractional-index keys as actions.rank.
  // Unlike actions, containers default to the shared midpoint key instead of a
  // backfilled sequence: lists sort by (rank, name), so an untouched group
  // reads alphabetically until the first drag renumbers it.
  rank: text("rank").notNull().default(DEFAULT_RANK),
  // Archive instead of delete for every container type (SPEC §3).
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  creatorId: text("creator_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const focuses = sqliteTable(
  "focuses",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // Optional git repository this focus mirrors (PROG-102). A focus maps to at
    // most one repo; the URL is display-only (a clickable link + agent context)
    // — PR/commit webhooks match by action key, not by this field. null = a
    // repo-less focus (household/personal areas, SPEC §3). Replaces the former
    // first-class `repos` container.
    gitUrl: text("git_url"),
    // Action-key prefix, e.g. "PROG" → PROG-123. Globally unique.
    keyPrefix: text("key_prefix").notNull(),
    // Per-focus action-number sequence; incremented on action create and on
    // cross-focus move (SPEC §3 movement rules).
    nextActionNumber: integer("next_action_number").notNull().default(1),
    // Manual outline order (PROG-87) — see workspaces.rank.
    rank: text("rank").notNull().default(DEFAULT_RANK),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("focuses_key_prefix_unique").on(t.keyPrefix)],
);

export const arcs = sqliteTable(
  "arcs",
  {
    id: text("id").primaryKey(),
    focusId: text("focus_id")
      .notNull()
      .references(() => focuses.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // Manual outline order (PROG-87) — see workspaces.rank.
    rank: text("rank").notNull().default(DEFAULT_RANK),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("arcs_focus_idx").on(t.focusId)],
);

export const actions = sqliteTable(
  "actions",
  {
    id: text("id").primaryKey(),
    // Container model (SPEC §3, PROG-102): focusId is always set and is the sole
    // container. arc same-focus is an API-enforced invariant. (The former repo
    // narrowing was removed in PROG-102 — repo is now a field on the focus.)
    focusId: text("focus_id")
      .notNull()
      .references(() => focuses.id),
    arcId: text("arc_id").references(() => arcs.id),
    // Step parent (PROG-124): a nullable self-reference making this action a
    // child of another action, nestable to unbounded depth. A step is just
    // an action with a parent — one data type, not a separate entity. The
    // same-focus and acyclic invariants SQLite can't express are API-enforced
    // (like arcId above). The Outline view (`/outline`) is the primary
    // editor; the board hides children unless "show steps" is on.
    parentActionId: text("parent_action_id").references((): AnySQLiteColumn => actions.id),
    // Key = focus.keyPrefix + "-" + number, derived, never stored — so a
    // prefix rename can't orphan keys. Unique per focus.
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: ACTION_STATUSES }).notNull().default("backlog"),
    priority: text("priority", { enum: ACTION_PRIORITIES }).notNull().default("none"),
    // Points from ACTION_ESTIMATES; null = unestimated. API-validated.
    estimate: integer("estimate"),
    // Optional due date (SPEC v2 §5): a wall-calendar day, identical
    // everywhere — stored as ISO `YYYY-MM-DD` text, NOT an instant (unlike the
    // createdAt/updatedAt timestamps). null = no due date. API-validated.
    dueDate: text("due_date"),
    // Manual board ordering (PROG-43): a fractional-index key — see
    // `src/shared/rank.ts`. Actions in a column sort by this lexicographically,
    // so dropping one between two others is a single-row write. Always set
    // (server-assigned on create, backfilled by migration 0005); the "" default
    // exists only so the ADD COLUMN is valid before backfill.
    rank: text("rank").notNull().default(""),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id),
    assigneeId: text("assignee_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("actions_focus_number_unique").on(t.focusId, t.number),
    index("actions_arc_idx").on(t.arcId),
    index("actions_parent_idx").on(t.parentActionId),
    index("actions_status_idx").on(t.status),
  ],
);

// Old keys after a cross-focus move; permanent redirects so references in
// commits and notes never break (SPEC §3, §8.4).
export const actionKeyAliases = sqliteTable("action_key_aliases", {
  // The full retired key, e.g. "PROG-123".
  key: text("key").primaryKey(),
  actionId: text("action_id")
    .notNull()
    .references(() => actions.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Auto-assigned hex color (SPEC §9 open question #3, minimal default).
    color: text("color").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("tags_name_unique").on(t.name)],
);

export const actionTags = sqliteTable(
  "action_tags",
  {
    actionId: text("action_id")
      .notNull()
      .references(() => actions.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.actionId, t.tagId] })],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id")
      .notNull()
      .references(() => actions.id),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("comments_action_idx").on(t.actionId)],
);

// Append-only event log; comments and activity interleave into one timeline
// on the action page (SPEC §8.4). `data` carries the event-type-specific
// payload (old/new status, source/target container, linked PR, …).
export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id")
      .notNull()
      .references(() => actions.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    data: text("data", { mode: "json" })
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("activity_action_idx").on(t.actionId)],
);

// Git links (SPEC §5, D29) — the link tables D19 deferred to this milestone.
// Rows are written only by the GitHub webhook when a commit/PR mentions an
// action key ("magic words"). Linking is permanent: a later edit that removes
// the mention does not unlink. Composite PKs double as the dedupe guard for
// webhook redeliveries.

export const prLinks = sqliteTable(
  "pr_links",
  {
    actionId: text("action_id")
      .notNull()
      .references(() => actions.id),
    // "owner/name" — identifies the PR together with the number. Not an FK
    // to repos: links survive container renames/archives, and webhooks may
    // arrive from repos that aren't (yet) containers here.
    githubRepo: text("github_repo").notNull(),
    prNumber: integer("pr_number").notNull(),
    title: text("title").notNull(),
    // Mutable: the webhook updates state (and title) on PR events.
    state: text("state", { enum: PR_STATES }).notNull(),
    url: text("url").notNull(),
    sourceBranch: text("source_branch"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.actionId, t.githubRepo, t.prNumber] })],
);

export const commitLinks = sqliteTable(
  "commit_links",
  {
    actionId: text("action_id")
      .notNull()
      .references(() => actions.id),
    githubRepo: text("github_repo").notNull(),
    sha: text("sha").notNull(),
    // First line of the commit message only — display never needs more.
    message: text("message").notNull(),
    url: text("url").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.actionId, t.sha] })],
);

// Sign-in allowlist (D44): who may use the app, managed at runtime from the
// Admin page instead of the SUPER_ADMIN_EMAILS env secret. Super-admins (env)
// are allowed implicitly and are NOT stored here, so this list can never lock
// out the last admin. Email is stored lowercased; the unique index dedupes.
export const allowedEmails = sqliteTable(
  "allowed_emails",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    // Optional free-text label (e.g. "Jane — contractor"); purely for the owner.
    note: text("note").notNull().default(""),
    // Email of the super-admin who added the row — light-touch audit trail.
    addedByEmail: text("added_by_email").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("allowed_emails_email_unique").on(t.email)],
);

// Uploaded/pasted images (PROG-42). The blob lives in R2 (`r2Key`); this row is
// the D1 record so the worker can authorize and look up an image by id, and
// attribute it to its uploader. Referenced from description/comment markdown as
// `/api/images/<id>`; never hard-deleted with its action (orphans are harmless).
export const images = sqliteTable("images", {
  id: text("id").primaryKey(),
  r2Key: text("r2_key").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  uploaderId: text("uploader_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Focus = typeof focuses.$inferSelect;
export type Arc = typeof arcs.$inferSelect;
export type Action = typeof actions.$inferSelect;
export type ActionKeyAlias = typeof actionKeyAliases.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type ActionTag = typeof actionTags.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Activity = typeof activity.$inferSelect;
export type PrLink = typeof prLinks.$inferSelect;
export type CommitLink = typeof commitLinks.$inferSelect;
export type AllowedEmail = typeof allowedEmails.$inferSelect;
export type Image = typeof images.$inferSelect;
