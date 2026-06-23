ALTER TABLE `issues` ADD `rank` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- PROG-43: seed every existing issue a fractional-index board rank so the
-- kanban has a stable initial order. Keys are width-12 zero-padded decimals,
-- spaced by 1000 and offset by 1 so they never end in "0" — the canonical form
-- src/shared/rank.ts needs to keep any gap subdividable. The seed order mirrors
-- the board's old sort (by product, then issue number) so nothing visibly jumps
-- on first load.
UPDATE `issues` SET `rank` = printf('%012d', 1000 * (
  SELECT count(*) FROM `issues` AS b
  WHERE b.product_id < `issues`.product_id
     OR (b.product_id = `issues`.product_id AND b.number < `issues`.number)
) + 1);
