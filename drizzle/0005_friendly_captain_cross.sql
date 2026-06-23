CREATE TABLE `allowed_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`added_by_email` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `allowed_emails_email_unique` ON `allowed_emails` (`email`);