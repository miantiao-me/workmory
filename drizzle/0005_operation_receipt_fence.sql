DROP TRIGGER `memory_revision_cas_guard`;
--> statement-breakpoint
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
	END;
END;
