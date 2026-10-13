PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_semantic_vectors` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`vector_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`model` text NOT NULL,
	`dimensions` integer NOT NULL,
	`index_version` text NOT NULL,
	`mutation_id` text NOT NULL,
	`indexed_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `semantic_vectors`;--> statement-breakpoint
ALTER TABLE `__new_semantic_vectors` RENAME TO `semantic_vectors`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `semantic_vectors_vector_uq` ON `semantic_vectors` (`vector_id`);--> statement-breakpoint
ALTER TABLE `index_outbox` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `index_outbox` ADD `mutation_id` text;--> statement-breakpoint
ALTER TABLE `index_outbox` ADD `claimed_at` integer;--> statement-breakpoint
ALTER TABLE `index_outbox` ADD `processed_at` integer;
