import { sql } from "drizzle-orm";
import {
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

// Fixed vocabularies (SPEC §3 — rigid simplicity, not configurable).
export const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

// Estimate is Linear-style points (SPEC §9 open question #1, default taken).
export const ISSUE_ESTIMATES = [0, 1, 2, 3, 5, 8] as const;

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
    // Key = product.keyPrefix + "-" + number, derived, never stored — so a
    // prefix rename can't orphan keys. Unique per product.
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: ISSUE_STATUSES }).notNull().default("backlog"),
    priority: text("priority", { enum: ISSUE_PRIORITIES }).notNull().default("none"),
    // Points from ISSUE_ESTIMATES; null = unestimated. API-validated.
    estimate: integer("estimate"),
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
