CREATE TABLE `commit_links` (
	`issue_id` text NOT NULL,
	`github_repo` text NOT NULL,
	`sha` text NOT NULL,
	`message` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`issue_id`, `sha`),
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pr_links` (
	`issue_id` text NOT NULL,
	`github_repo` text NOT NULL,
	`pr_number` integer NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`url` text NOT NULL,
	`source_branch` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`issue_id`, `github_repo`, `pr_number`),
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
