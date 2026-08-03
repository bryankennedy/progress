CREATE TABLE `diary_summaries` (
	`day` text PRIMARY KEY NOT NULL,
	`digest_hash` text NOT NULL,
	`summary` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
