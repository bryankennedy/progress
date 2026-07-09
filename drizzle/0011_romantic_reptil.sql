-- PROG-102: demote Repo from a first-class container to an optional field on
-- Focus (focuses.git_url), and drop the `repos` table + `actions.repo_id`.
--
-- Why this is written by hand and not the drizzle-kit default: dropping
-- `actions.repo_id` requires rebuilding the `actions` table (the column carries
-- a foreign key, so SQLite's ALTER TABLE DROP COLUMN refuses it). The standard
-- drizzle rebuild (create __new_actions, copy, DROP actions, rename) relies on
-- `PRAGMA foreign_keys=OFF`, which D1/workerd ignores inside the migration's
-- transaction — and `defer_foreign_keys` does not clear the violation counter
-- that DROP TABLE's implicit delete leaves behind, so the commit is rejected.
-- The workerd-safe pattern is to move every child row of `actions` out to a
-- temp table, delete it, rebuild `actions`, then restore the rows against the
-- rebuilt table. All FKs are satisfied at every commit point, no PRAGMA needed.
--
-- Backfill rule (PROG-102 "auto-fold"): each focus adopts the git_url of its
-- oldest repo that has a non-empty url, preferring a live (non-archived) repo
-- over an archived one. Focuses with no such repo keep NULL. A focus that
-- mapped to 2+ repos with different urls keeps only the first — those are
-- flagged in the PR for manual review. Actions lose repo narrowing, keep focus.

-- 1. New optional repo field on focus, backfilled from repos before they vanish.
ALTER TABLE `focuses` ADD `git_url` text;--> statement-breakpoint
UPDATE `focuses` SET `git_url` = (
	SELECT r.git_url FROM `repos` r
	WHERE r.focus_id = `focuses`.id
		AND r.git_url IS NOT NULL
		AND r.git_url != ''
	ORDER BY (r.archived_at IS NULL) DESC, r.created_at ASC
	LIMIT 1
);--> statement-breakpoint

-- 2. Park every child row of `actions` so the table can be dropped FK-clean.
CREATE TABLE `__tmp_action_tags` AS SELECT * FROM `action_tags`;--> statement-breakpoint
CREATE TABLE `__tmp_comments` AS SELECT * FROM `comments`;--> statement-breakpoint
CREATE TABLE `__tmp_activity` AS SELECT * FROM `activity`;--> statement-breakpoint
CREATE TABLE `__tmp_pr_links` AS SELECT * FROM `pr_links`;--> statement-breakpoint
CREATE TABLE `__tmp_commit_links` AS SELECT * FROM `commit_links`;--> statement-breakpoint
CREATE TABLE `__tmp_action_key_aliases` AS SELECT * FROM `action_key_aliases`;--> statement-breakpoint
DELETE FROM `action_tags`;--> statement-breakpoint
DELETE FROM `comments`;--> statement-breakpoint
DELETE FROM `activity`;--> statement-breakpoint
DELETE FROM `pr_links`;--> statement-breakpoint
DELETE FROM `commit_links`;--> statement-breakpoint
DELETE FROM `action_key_aliases`;--> statement-breakpoint

-- 3. Rebuild `actions` without `repo_id`. The self-FK points at `__new_actions`
--    (not `actions`) so the copied step rows are children of the NEW table, not
--    the old one — otherwise they'd block the DROP below. SQLite rewrites that
--    reference to `actions` when the table is renamed. Copy first (retains
--    parent links), then null the OLD table's parent so its implicit delete on
--    DROP can't transiently violate the self-FK.
CREATE TABLE `__new_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`focus_id` text NOT NULL,
	`arc_id` text,
	`parent_action_id` text,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'backlog' NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`estimate` integer,
	`due_date` text,
	`rank` text DEFAULT '' NOT NULL,
	`creator_id` text NOT NULL,
	`assignee_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`focus_id`) REFERENCES `focuses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`arc_id`) REFERENCES `arcs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_action_id`) REFERENCES `__new_actions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_actions`("id", "focus_id", "arc_id", "parent_action_id", "number", "title", "description", "status", "priority", "estimate", "due_date", "rank", "creator_id", "assignee_id", "created_at", "updated_at", "completed_at") SELECT "id", "focus_id", "arc_id", "parent_action_id", "number", "title", "description", "status", "priority", "estimate", "due_date", "rank", "creator_id", "assignee_id", "created_at", "updated_at", "completed_at" FROM `actions`;--> statement-breakpoint
UPDATE `actions` SET `parent_action_id` = NULL;--> statement-breakpoint
DROP TABLE `actions`;--> statement-breakpoint
ALTER TABLE `__new_actions` RENAME TO `actions`;--> statement-breakpoint
CREATE UNIQUE INDEX `actions_focus_number_unique` ON `actions` (`focus_id`,`number`);--> statement-breakpoint
CREATE INDEX `actions_arc_idx` ON `actions` (`arc_id`);--> statement-breakpoint
CREATE INDEX `actions_parent_idx` ON `actions` (`parent_action_id`);--> statement-breakpoint
CREATE INDEX `actions_status_idx` ON `actions` (`status`);--> statement-breakpoint

-- 4. Restore every child row against the rebuilt `actions`, then drop temps.
INSERT INTO `action_tags` SELECT * FROM `__tmp_action_tags`;--> statement-breakpoint
INSERT INTO `comments` SELECT * FROM `__tmp_comments`;--> statement-breakpoint
INSERT INTO `activity` SELECT * FROM `__tmp_activity`;--> statement-breakpoint
INSERT INTO `pr_links` SELECT * FROM `__tmp_pr_links`;--> statement-breakpoint
INSERT INTO `commit_links` SELECT * FROM `__tmp_commit_links`;--> statement-breakpoint
INSERT INTO `action_key_aliases` SELECT * FROM `__tmp_action_key_aliases`;--> statement-breakpoint
DROP TABLE `__tmp_action_tags`;--> statement-breakpoint
DROP TABLE `__tmp_comments`;--> statement-breakpoint
DROP TABLE `__tmp_activity`;--> statement-breakpoint
DROP TABLE `__tmp_pr_links`;--> statement-breakpoint
DROP TABLE `__tmp_commit_links`;--> statement-breakpoint
DROP TABLE `__tmp_action_key_aliases`;--> statement-breakpoint

-- 5. Repos is now unreferenced (repo_id is gone) — drop it.
DROP TABLE `repos`;
