CREATE TABLE `canonical_object_staging` (
	`object_key` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`revision` integer NOT NULL,
	`write_token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`claim_token` text,
	`claimed_at` integer,
	`last_error` text,
	`delete_confirmations` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `canonical_object_staging_due_idx` ON `canonical_object_staging` (`status`,`next_attempt_at`,`created_at`,`object_key`);--> statement-breakpoint
CREATE TABLE `vector_cleanup` (
	`id` text PRIMARY KEY NOT NULL,
	`vector_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`claim_token` text,
	`claimed_at` integer,
	`last_error` text,
	`retain_tombstone` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vector_cleanup_vector_uq` ON `vector_cleanup` (`vector_id`);--> statement-breakpoint
CREATE INDEX `vector_cleanup_due_idx` ON `vector_cleanup` (`status`,`next_attempt_at`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `vector_staging` (
	`vector_id` text PRIMARY KEY NOT NULL,
	`outbox_id` text NOT NULL,
	`memory_id` text NOT NULL,
	`revision` integer NOT NULL,
	`claim_token` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vector_staging_created_idx` ON `vector_staging` (`created_at`,`vector_id`);--> statement-breakpoint
ALTER TABLE `attachments` ADD `lifecycle` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `attachments` ADD `delete_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `attachments` ADD `delete_next_attempt_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `attachments` ADD `delete_claim_token` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `delete_claimed_at` integer;--> statement-breakpoint
ALTER TABLE `memory_revisions` ADD `canonical_stage_token` text;--> statement-breakpoint
DROP TRIGGER `memory_revision_cas_guard`;--> statement-breakpoint
CREATE TRIGGER `memory_revision_cas_guard`
BEFORE INSERT ON `memory_revisions`
BEGIN
	SELECT CASE
		WHEN (SELECT `current_revision` FROM `memories` WHERE `id` = NEW.`memory_id`) IS NULL
			THEN RAISE(ABORT, 'memory_missing')
		WHEN (SELECT `current_revision` FROM `memories` WHERE `id` = NEW.`memory_id`) + 1 != NEW.`revision`
			THEN RAISE(ABORT, 'revision_conflict')
		WHEN NEW.`operation_id` IS NOT NULL AND NOT EXISTS (
			SELECT 1 FROM `operation_receipts` receipt
			WHERE receipt.`owner_id` = NEW.`owner_id`
			  AND receipt.`operation_id` = NEW.`operation_id`
			  AND receipt.`request_hash` = NEW.`operation_hash`
			  AND receipt.`status` = 'complete'
			  AND receipt.`action` = NEW.`action`
			  AND receipt.`memory_id` = NEW.`memory_id`
			  AND receipt.`revision` = NEW.`revision`
			  AND receipt.`object_key` IS NEW.`object_key`
			  AND receipt.`content_hash` = NEW.`content_hash`
		)
			THEN RAISE(ABORT, 'operation_claim_lost')
		WHEN NEW.`action` = 'upsert' AND NEW.`canonical_stage_token` IS NULL
			THEN RAISE(ABORT, 'canonical_stage_claim_lost')
		WHEN NEW.`action` = 'upsert' AND NOT EXISTS (
			SELECT 1 FROM `canonical_object_staging` stage
			WHERE stage.`object_key` = NEW.`object_key`
			  AND stage.`memory_id` = NEW.`memory_id`
			  AND stage.`revision` = NEW.`revision`
			  AND stage.`write_token` = NEW.`canonical_stage_token`
			  AND stage.`status` = 'processing'
			  AND stage.`claim_token` = NEW.`canonical_stage_token`
			  AND stage.`delete_confirmations` = 0
		)
			THEN RAISE(ABORT, 'canonical_stage_claim_lost')
	END;
END;
