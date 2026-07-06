-- PROG-87: manual outline order for containers, the same fractional-index keys
-- as issues.rank (PROG-43 / migration 0005). No backfill on purpose: every row
-- starts at the shared midpoint key 'V' (= rankBetween(null, null)), the client
-- sorts by (rank, name), so a group nobody has reordered keeps reading
-- alphabetically; the first drag in a group renumbers that group.
ALTER TABLE `arcs` ADD `rank` text DEFAULT 'V' NOT NULL;--> statement-breakpoint
ALTER TABLE `initiatives` ADD `rank` text DEFAULT 'V' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `rank` text DEFAULT 'V' NOT NULL;