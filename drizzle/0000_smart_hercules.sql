CREATE TABLE `index_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`memory_id` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`operation_id` text,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `index_outbox_memory_revision_action_uq` ON `index_outbox` (`memory_id`,`revision`,`action`);--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`namespace` text NOT NULL,
	`key` text NOT NULL,
	`current_revision` integer DEFAULT 0 NOT NULL,
	`current_object_key` text,
	`current_hash` text,
	`kind` text,
	`status` text DEFAULT 'stable' NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memories_project_namespace_key_uq` ON `memories` (`project_id`,`namespace`,`key`);--> statement-breakpoint
CREATE INDEX `memories_project_namespace_idx` ON `memories` (`project_id`,`namespace`);--> statement-breakpoint
CREATE TABLE `memory_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`memory_id` text NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`object_key` text,
	`content_hash` text NOT NULL,
	`operation_id` text,
	`operation_hash` text,
	`actor_id` text NOT NULL,
	`auth_kind` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_revisions_memory_revision_uq` ON `memory_revisions` (`memory_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_revisions_owner_operation_uq` ON `memory_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `memory_search_docs` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`namespace` text NOT NULL,
	`revision` integer NOT NULL,
	`key` text NOT NULL,
	`tags` text NOT NULL,
	`kind` text,
	`status` text NOT NULL,
	`content` text NOT NULL,
	`snippet` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `memory_tags` (
	`memory_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`memory_id`, `tag`),
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_tags_tag_idx` ON `memory_tags` (`tag`,`memory_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_owner_slug_uq` ON `projects` (`owner_id`,`slug`);--> statement-breakpoint
CREATE TABLE `semantic_vectors` (
	`memory_id` text NOT NULL,
	`revision` integer NOT NULL,
	`vector_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`indexed_at` integer NOT NULL,
	PRIMARY KEY(`memory_id`, `revision`),
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `semantic_vectors_vector_uq` ON `semantic_vectors` (`vector_id`);
--> statement-breakpoint
CREATE TRIGGER `memory_revision_cas_guard`
BEFORE INSERT ON `memory_revisions`
BEGIN
	SELECT CASE
		WHEN (SELECT `current_revision` FROM `memories` WHERE `id` = NEW.`memory_id`) IS NULL
			THEN RAISE(ABORT, 'memory_missing')
		WHEN (SELECT `current_revision` FROM `memories` WHERE `id` = NEW.`memory_id`) + 1 != NEW.`revision`
			THEN RAISE(ABORT, 'revision_conflict')
	END;
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE `memory_search_fts` USING fts5(
	`memory_id` UNINDEXED,
	`project_id` UNINDEXED,
	`namespace` UNINDEXED,
	`key`,
	`tags`,
	`content`,
	tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER `memory_search_docs_ai` AFTER INSERT ON `memory_search_docs` BEGIN
	INSERT INTO `memory_search_fts` (`memory_id`, `project_id`, `namespace`, `key`, `tags`, `content`)
	VALUES (NEW.`memory_id`, NEW.`project_id`, NEW.`namespace`, NEW.`key`, NEW.`tags`, NEW.`content`);
END;
--> statement-breakpoint
CREATE TRIGGER `memory_search_docs_ad` AFTER DELETE ON `memory_search_docs` BEGIN
	DELETE FROM `memory_search_fts` WHERE `memory_id` = OLD.`memory_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `memory_search_docs_au` AFTER UPDATE ON `memory_search_docs` BEGIN
	DELETE FROM `memory_search_fts` WHERE `memory_id` = OLD.`memory_id`;
	INSERT INTO `memory_search_fts` (`memory_id`, `project_id`, `namespace`, `key`, `tags`, `content`)
	VALUES (NEW.`memory_id`, NEW.`project_id`, NEW.`namespace`, NEW.`key`, NEW.`tags`, NEW.`content`);
END;
