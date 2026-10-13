CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_url` text,
	`filename` text NOT NULL,
	`declared_mime` text,
	`detected_mime` text NOT NULL,
	`original_size` integer NOT NULL,
	`original_sha256` text NOT NULL,
	`original_r2_key` text NOT NULL,
	`markdown_size` integer,
	`markdown_sha256` text,
	`markdown_r2_key` text,
	`conversion_id` text,
	`conversion_tokens` integer,
	`converter` text,
	`error_code` text,
	`actor_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`quarantine_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_project_actor_idempotency_uq` ON `attachments` (`project_id`,`actor_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `attachments_status_quarantine_idx` ON `attachments` (`status`,`quarantine_at`);--> statement-breakpoint
CREATE TABLE `memory_revision_attachments` (
	`memory_revision_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	PRIMARY KEY(`memory_revision_id`, `attachment_id`),
	FOREIGN KEY (`memory_revision_id`) REFERENCES `memory_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action
);
