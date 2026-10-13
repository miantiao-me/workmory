import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    slug: text("slug").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("projects_owner_slug_uq").on(table.ownerId, table.slug)],
);

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    namespace: text("namespace").notNull(),
    key: text("key").notNull(),
    currentRevision: integer("current_revision").notNull().default(0),
    currentObjectKey: text("current_object_key"),
    currentHash: text("current_hash"),
    kind: text("kind"),
    status: text("status").notNull().default("stable"),
    deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
    indexable: integer("indexable", { mode: "boolean" }).notNull().default(true),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("memories_project_namespace_key_uq").on(table.projectId, table.namespace, table.key),
    index("memories_project_namespace_idx").on(table.projectId, table.namespace),
    index("memories_list_idx").on(
      table.projectId,
      table.namespace,
      table.indexable,
      table.deleted,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const memoryRevisions = sqliteTable(
  "memory_revisions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    memoryId: text("memory_id").notNull().references(() => memories.id),
    revision: integer("revision").notNull(),
    action: text("action", { enum: ["upsert", "delete"] }).notNull(),
    objectKey: text("object_key"),
    canonicalStageToken: text("canonical_stage_token"),
    contentHash: text("content_hash").notNull(),
    operationId: text("operation_id"),
    operationHash: text("operation_hash"),
    actorId: text("actor_id").notNull(),
    authKind: text("auth_kind", { enum: ["access", "root"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("memory_revisions_memory_revision_uq").on(table.memoryId, table.revision),
    uniqueIndex("memory_revisions_owner_operation_uq").on(table.ownerId, table.operationId),
  ],
);

export const memoryTags = sqliteTable(
  "memory_tags",
  {
    memoryId: text("memory_id").notNull().references(() => memories.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.memoryId, table.tag] }),
    index("memory_tags_tag_idx").on(table.tag, table.memoryId),
  ],
);

export const memorySearchDocs = sqliteTable("memory_search_docs", {
  memoryId: text("memory_id").primaryKey().references(() => memories.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id),
  namespace: text("namespace").notNull(),
  revision: integer("revision").notNull(),
  key: text("key").notNull(),
  tags: text("tags").notNull(),
  kind: text("kind"),
  status: text("status").notNull(),
  content: text("content").notNull(),
  snippet: text("snippet").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const memoryLinks = sqliteTable(
  "memory_links",
  {
    sourceMemoryId: text("source_memory_id").notNull().references(() => memories.id, { onDelete: "cascade" }),
    sourceRevision: integer("source_revision").notNull(),
    targetMemoryId: text("target_memory_id").notNull(),
    targetKey: text("target_key").notNull(),
    origin: text("origin", { enum: ["link", "source"] }).notNull(),
    rawTarget: text("raw_target").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceMemoryId, table.ordinal] }),
    index("memory_links_source_revision_idx").on(table.sourceMemoryId, table.sourceRevision),
    index("memory_links_target_idx").on(table.targetMemoryId, table.sourceMemoryId),
  ],
);

export const memoryLinkIndex = sqliteTable(
  "memory_link_index",
  {
    memoryId: text("memory_id").primaryKey().references(() => memories.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    status: text("status", { enum: ["pending", "complete", "failed"] }).notNull(),
    truncated: integer("truncated", { mode: "boolean" }).notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
  },
  (table) => [index("memory_link_index_status_next_attempt_idx").on(table.status, table.nextAttemptAt)],
);

export const indexOutbox = sqliteTable(
  "index_outbox",
  {
    id: text("id").primaryKey(),
    action: text("action", { enum: ["upsert", "delete"] }).notNull(),
    memoryId: text("memory_id").notNull().references(() => memories.id),
    revision: integer("revision").notNull(),
    status: text("status", { enum: ["pending", "processing", "done"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    operationId: text("operation_id"),
    contentHash: text("content_hash").notNull(),
    lastError: text("last_error"),
    mutationId: text("mutation_id"),
    claimedAt: integer("claimed_at"),
    claimToken: text("claim_token"),
    processedAt: integer("processed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("index_outbox_memory_revision_action_uq").on(table.memoryId, table.revision, table.action),
    index("index_outbox_status_next_attempt_idx").on(table.status, table.nextAttemptAt),
  ],
);

export const semanticVectors = sqliteTable(
  "semantic_vectors",
  {
    memoryId: text("memory_id").primaryKey().references(() => memories.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    vectorId: text("vector_id").notNull(),
    contentHash: text("content_hash").notNull(),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    indexVersion: text("index_version").notNull(),
    mutationId: text("mutation_id").notNull(),
    indexedAt: integer("indexed_at").notNull(),
  },
  (table) => [uniqueIndex("semantic_vectors_vector_uq").on(table.vectorId)],
);

export const vectorStaging = sqliteTable(
  "vector_staging",
  {
    vectorId: text("vector_id").primaryKey(),
    outboxId: text("outbox_id").notNull(),
    memoryId: text("memory_id").notNull(),
    revision: integer("revision").notNull(),
    claimToken: text("claim_token").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("vector_staging_created_idx").on(table.createdAt, table.vectorId)],
);

export const vectorCleanup = sqliteTable(
  "vector_cleanup",
  {
    id: text("id").primaryKey(),
    vectorId: text("vector_id").notNull(),
    status: text("status", { enum: ["pending", "processing"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    claimToken: text("claim_token"),
    claimedAt: integer("claimed_at"),
    lastError: text("last_error"),
    retainTombstone: integer("retain_tombstone", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("vector_cleanup_vector_uq").on(table.vectorId),
    index("vector_cleanup_due_idx").on(table.status, table.nextAttemptAt, table.createdAt, table.id),
  ],
);

export const canonicalObjectStaging = sqliteTable(
  "canonical_object_staging",
  {
    objectKey: text("object_key").primaryKey(),
    memoryId: text("memory_id").notNull(),
    revision: integer("revision").notNull(),
    writeToken: text("write_token").notNull(),
    status: text("status", { enum: ["pending", "processing"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    claimToken: text("claim_token"),
    claimedAt: integer("claimed_at"),
    lastError: text("last_error"),
    deleteConfirmations: integer("delete_confirmations").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("canonical_object_staging_due_idx").on(table.status, table.nextAttemptAt, table.createdAt, table.objectKey)],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    status: text("status", { enum: ["processing", "ready", "failed", "deleting", "deleted"] }).notNull(),
    sourceKind: text("source_kind", { enum: ["upload", "url"] }).notNull(),
    sourceUrl: text("source_url"),
    lifecycle: text("lifecycle", { enum: ["user", "memory_source"] }).notNull().default("user"),
    filename: text("filename").notNull(),
    declaredMime: text("declared_mime"),
    detectedMime: text("detected_mime").notNull(),
    originalSize: integer("original_size").notNull(),
    originalSha256: text("original_sha256").notNull(),
    originalR2Key: text("original_r2_key").notNull(),
    markdownSize: integer("markdown_size"),
    markdownSha256: text("markdown_sha256"),
    markdownR2Key: text("markdown_r2_key"),
    conversionId: text("conversion_id"),
    conversionTokens: integer("conversion_tokens"),
    converter: text("converter"),
    errorCode: text("error_code"),
    actorId: text("actor_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    quarantineAt: integer("quarantine_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    deleteAttempts: integer("delete_attempts").notNull().default(0),
    deleteNextAttemptAt: integer("delete_next_attempt_at").notNull().default(0),
    deleteClaimToken: text("delete_claim_token"),
    deleteClaimedAt: integer("delete_claimed_at"),
  },
  (table) => [
    uniqueIndex("attachments_project_actor_idempotency_uq").on(table.projectId, table.actorId, table.idempotencyKey),
    index("attachments_status_quarantine_idx").on(table.status, table.quarantineAt),
  ],
);

export const memoryRevisionAttachments = sqliteTable(
  "memory_revision_attachments",
  {
    memoryRevisionId: text("memory_revision_id").notNull().references(() => memoryRevisions.id),
    attachmentId: text("attachment_id").notNull().references(() => attachments.id),
  },
  (table) => [
    primaryKey({ columns: [table.memoryRevisionId, table.attachmentId] }),
    index("memory_revision_attachments_attachment_idx").on(table.attachmentId),
  ],
);

export const operationReceipts = sqliteTable(
  "operation_receipts",
  {
    ownerId: text("owner_id").notNull(),
    operationId: text("operation_id").notNull(),
    requestHash: text("request_hash").notNull(),
    action: text("action", { enum: ["upsert", "delete"] }).notNull(),
    memoryId: text("memory_id").notNull(),
    project: text("project").notNull(),
    namespace: text("namespace").notNull(),
    memoryKey: text("memory_key").notNull(),
    status: text("status", { enum: ["processing", "complete"] }).notNull(),
    revision: integer("revision"),
    objectKey: text("object_key"),
    contentHash: text("content_hash"),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
    claimToken: text("claim_token"),
    claimedAt: integer("claimed_at"),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.operationId] })],
);
