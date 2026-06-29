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

// All IDs are app-generated text with a type prefix (usr_, ini_, prd_, rep_,
// arc_, iss_, tag_, cmt_, act_) so any id is identifiable on sight in logs
// and URLs. Timestamps are unix-epoch integers set by the API (seeds use
// unixepoch()).

// Fixed vocabularies live in src/shared/constants.ts (shared with the
// client); re-exported here so DB-adjacent code keeps one import site.
import { ISSUE_PRIORITIES, ISSUE_STATUSES, PR_STATES } from "../shared/constants";

export { ISSUE_ESTIMATES, ISSUE_PRIORITIES, ISSUE_STATUSES, PR_STATES } from "../shared/constants";
export type { IssuePriority, IssueStatus, PrState } from "../shared/constants";

// Multi-user-ready from day one (SPEC §8.4, D13): one row in v1, but
// creator/assignee/author foreign keys point here.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const initiatives = sqliteTable("initiatives", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // Archive instead of delete for every container type (SPEC §3).
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  creatorId: text("creator_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    initiativeId: text("initiative_id")
      .notNull()
      .references(() => initiatives.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // Issue-key prefix, e.g. "PROG" → PROG-123. Globally unique.
    keyPrefix: text("key_prefix").notNull(),
    // Per-product issue-number sequence; incremented on issue create and on
    // cross-product move (SPEC §3 movement rules).
    nextIssueNumber: integer("next_issue_number").notNull().default(1),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("products_key_prefix_unique").on(t.keyPrefix)],
);

export const repos = sqliteTable(
  "repos",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // The real repository this container mirrors (SPEC §3). Optional until
    // connected; the GitHub webhook milestone keys off it.
    gitUrl: text("git_url"),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("repos_product_idx").on(t.productId)],
);

export const arcs = sqliteTable(
  "arcs",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("arcs_product_idx").on(t.productId)],
);

export const issues = sqliteTable(
  "issues",
  {
    id: text("id").primaryKey(),
    // Container model (SPEC §3): productId is always set; repoId narrows the
    // container to one of that product's repos. repoId ∈ product's repos and
    // arc same-product are API-enforced invariants.
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    repoId: text("repo_id").references(() => repos.id),
    arcId: text("arc_id").references(() => arcs.id),
    // Sub-issue parent (PROG-124): a nullable self-reference making this issue a
    // child of another issue, nestable to unbounded depth. A sub-issue is just
    // an issue with a parent — one data type, not a separate entity. The
    // same-product and acyclic invariants SQLite can't express are API-enforced
    // (like repoId/arcId above). The Outline view (`/outline`) is the primary
    // editor; the board hides children unless "show sub-issues" is on.
    parentIssueId: text("parent_issue_id").references((): AnySQLiteColumn => issues.id),
    // Key = product.keyPrefix + "-" + number, derived, never stored — so a
    // prefix rename can't orphan keys. Unique per product.
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: ISSUE_STATUSES }).notNull().default("backlog"),
    priority: text("priority", { enum: ISSUE_PRIORITIES }).notNull().default("none"),
    // Points from ISSUE_ESTIMATES; null = unestimated. API-validated.
    estimate: integer("estimate"),
    // Optional due date (SPEC v2 §5): a wall-calendar day, identical
    // everywhere — stored as ISO `YYYY-MM-DD` text, NOT an instant (unlike the
    // createdAt/updatedAt timestamps). null = no due date. API-validated.
    dueDate: text("due_date"),
    // Manual board ordering (PROG-43): a fractional-index key — see
    // `src/shared/rank.ts`. Issues in a column sort by this lexicographically,
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
    uniqueIndex("issues_product_number_unique").on(t.productId, t.number),
    index("issues_repo_idx").on(t.repoId),
    index("issues_arc_idx").on(t.arcId),
    index("issues_parent_idx").on(t.parentIssueId),
    index("issues_status_idx").on(t.status),
  ],
);

// Old keys after a cross-product move; permanent redirects so references in
// commits and notes never break (SPEC §3, §8.4).
export const issueKeyAliases = sqliteTable("issue_key_aliases", {
  // The full retired key, e.g. "PROG-123".
  key: text("key").primaryKey(),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id),
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

export const issueTags = sqliteTable(
  "issue_tags",
  {
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.tagId] })],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("comments_issue_idx").on(t.issueId)],
);

// Append-only event log; comments and activity interleave into one timeline
// on the issue page (SPEC §8.4). `data` carries the event-type-specific
// payload (old/new status, source/target container, linked PR, …).
export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    data: text("data", { mode: "json" }).notNull().default(sql`'{}'`),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("activity_issue_idx").on(t.issueId)],
);

// Git links (SPEC §5, D29) — the link tables D19 deferred to this milestone.
// Rows are written only by the GitHub webhook when a commit/PR mentions an
// issue key ("magic words"). Linking is permanent: a later edit that removes
// the mention does not unlink. Composite PKs double as the dedupe guard for
// webhook redeliveries.

export const prLinks = sqliteTable(
  "pr_links",
  {
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id),
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
  (t) => [primaryKey({ columns: [t.issueId, t.githubRepo, t.prNumber] })],
);

export const commitLinks = sqliteTable(
  "commit_links",
  {
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id),
    githubRepo: text("github_repo").notNull(),
    sha: text("sha").notNull(),
    // First line of the commit message only — display never needs more.
    message: text("message").notNull(),
    url: text("url").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.sha] })],
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
// `/api/images/<id>`; never hard-deleted with its issue (orphans are harmless).
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
export type Initiative = typeof initiatives.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Repo = typeof repos.$inferSelect;
export type Arc = typeof arcs.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type IssueKeyAlias = typeof issueKeyAliases.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type IssueTag = typeof issueTags.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Activity = typeof activity.$inferSelect;
export type PrLink = typeof prLinks.$inferSelect;
export type CommitLink = typeof commitLinks.$inferSelect;
export type AllowedEmail = typeof allowedEmails.$inferSelect;
export type Image = typeof images.$inferSelect;
