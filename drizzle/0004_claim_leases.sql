ALTER TABLE `index_outbox` ADD `claim_token` text;--> statement-breakpoint
ALTER TABLE `operation_receipts` ADD `claim_token` text;--> statement-breakpoint
ALTER TABLE `operation_receipts` ADD `claimed_at` integer;