-- PROG-98: rename the hierarchy nouns in place — Workspace / Focus / Arc /
-- Action / Step. Pure renames (tables, columns, index names); no data is
-- copied and no shapes change. SQLite rewrites foreign-key clauses in
-- referencing tables on RENAME TO / RENAME COLUMN, so order only matters for
-- the indexes: SQLite has no RENAME INDEX, so the affected ones are dropped
-- by their old names first and recreated under the new names at the end.
-- Hand-written (drizzle-kit would see drop+create); the 0010 snapshot was
-- generated from the renamed schema so future diffs start clean.
DROP INDEX `products_key_prefix_unique`;--> statement-breakpoint
DROP INDEX `repos_product_idx`;--> statement-breakpoint
DROP INDEX `arcs_product_idx`;--> statement-breakpoint
DROP INDEX `issues_product_number_unique`;--> statement-breakpoint
DROP INDEX `issues_repo_idx`;--> statement-breakpoint
DROP INDEX `issues_arc_idx`;--> statement-breakpoint
DROP INDEX `issues_parent_idx`;--> statement-breakpoint
DROP INDEX `issues_status_idx`;--> statement-breakpoint
DROP INDEX `comments_issue_idx`;--> statement-breakpoint
DROP INDEX `activity_issue_idx`;--> statement-breakpoint
ALTER TABLE `initiatives` RENAME TO `workspaces`;--> statement-breakpoint
ALTER TABLE `products` RENAME TO `focuses`;--> statement-breakpoint
ALTER TABLE `issues` RENAME TO `actions`;--> statement-breakpoint
ALTER TABLE `issue_key_aliases` RENAME TO `action_key_aliases`;--> statement-breakpoint
ALTER TABLE `issue_tags` RENAME TO `action_tags`;--> statement-breakpoint
ALTER TABLE `focuses` RENAME COLUMN `initiative_id` TO `workspace_id`;--> statement-breakpoint
ALTER TABLE `focuses` RENAME COLUMN `next_issue_number` TO `next_action_number`;--> statement-breakpoint
ALTER TABLE `repos` RENAME COLUMN `product_id` TO `focus_id`;--> statement-breakpoint
ALTER TABLE `arcs` RENAME COLUMN `product_id` TO `focus_id`;--> statement-breakpoint
ALTER TABLE `actions` RENAME COLUMN `product_id` TO `focus_id`;--> statement-breakpoint
ALTER TABLE `actions` RENAME COLUMN `parent_issue_id` TO `parent_action_id`;--> statement-breakpoint
ALTER TABLE `action_key_aliases` RENAME COLUMN `issue_id` TO `action_id`;--> statement-breakpoint
ALTER TABLE `action_tags` RENAME COLUMN `issue_id` TO `action_id`;--> statement-breakpoint
ALTER TABLE `comments` RENAME COLUMN `issue_id` TO `action_id`;--> statement-breakpoint
ALTER TABLE `activity` RENAME COLUMN `issue_id` TO `action_id`;--> statement-breakpoint
ALTER TABLE `pr_links` RENAME COLUMN `issue_id` TO `action_id`;--> statement-breakpoint
ALTER TABLE `commit_links` RENAME COLUMN `issue_id` TO `action_id`;--> statement-breakpoint
CREATE UNIQUE INDEX `focuses_key_prefix_unique` ON `focuses` (`key_prefix`);--> statement-breakpoint
CREATE INDEX `repos_focus_idx` ON `repos` (`focus_id`);--> statement-breakpoint
CREATE INDEX `arcs_focus_idx` ON `arcs` (`focus_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `actions_focus_number_unique` ON `actions` (`focus_id`,`number`);--> statement-breakpoint
CREATE INDEX `actions_repo_idx` ON `actions` (`repo_id`);--> statement-breakpoint
CREATE INDEX `actions_arc_idx` ON `actions` (`arc_id`);--> statement-breakpoint
CREATE INDEX `actions_parent_idx` ON `actions` (`parent_action_id`);--> statement-breakpoint
CREATE INDEX `actions_status_idx` ON `actions` (`status`);--> statement-breakpoint
CREATE INDEX `comments_action_idx` ON `comments` (`action_id`);--> statement-breakpoint
CREATE INDEX `activity_action_idx` ON `activity` (`action_id`);
