ALTER TABLE `issues` ADD `parent_issue_id` text REFERENCES issues(id);--> statement-breakpoint
CREATE INDEX `issues_parent_idx` ON `issues` (`parent_issue_id`);