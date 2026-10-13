CREATE TABLE `operation_receipts` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`action` text NOT NULL,
	`memory_id` text NOT NULL,
	`project` text NOT NULL,
	`namespace` text NOT NULL,
	`memory_key` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer,
	`object_key` text,
	`content_hash` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TRIGGER `memory_revision_attachments_validate_insert`
BEFORE INSERT ON `memory_revision_attachments`
BEGIN
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1
		FROM `attachments` a
		JOIN `memory_revisions` r ON r.id = NEW.memory_revision_id
		JOIN `memories` m ON m.id = r.memory_id
		WHERE a.id = NEW.attachment_id
		  AND a.status = 'ready'
		  AND a.project_id = m.project_id
	) THEN RAISE(ABORT, 'attachment_not_ready_or_project_mismatch') END;
END;
