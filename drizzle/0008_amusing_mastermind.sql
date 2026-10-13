CREATE TABLE `memory_link_index` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`extractor_version` text NOT NULL,
	`status` text NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_link_index_status_next_attempt_idx` ON `memory_link_index` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `memory_links` (
	`source_memory_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`target_memory_id` text NOT NULL,
	`target_key` text NOT NULL,
	`origin` text NOT NULL,
	`raw_target` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`source_memory_id`, `ordinal`),
	FOREIGN KEY (`source_memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_links_source_revision_idx` ON `memory_links` (`source_memory_id`,`source_revision`);--> statement-breakpoint
CREATE INDEX `memory_links_target_idx` ON `memory_links` (`target_memory_id`,`source_memory_id`);--> statement-breakpoint
INSERT INTO `memory_link_index` (`memory_id`, `revision`, `extractor_version`, `status`, `truncated`, `attempts`, `next_attempt_at`)
SELECT `id`, `current_revision`, '1', 'pending', 0, 0, 0
FROM `memories`
WHERE `deleted` = 0 AND `indexable` = 1
  AND `current_object_key` IS NOT NULL AND `current_hash` IS NOT NULL;
