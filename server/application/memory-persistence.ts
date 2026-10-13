import type { ActorContext } from "../domain/identity";
import { opaqueId } from "../domain/identity";
import { MEMORY_LINK_EXTRACTOR_VERSION } from "../domain/memory-links";
import type { PreparedMemory } from "./memory-preparation";
import { MemoryServiceError } from "./memory-service";
import { memoryLinkInsertStatements } from "./memory-link-statements";

const SEARCH_CONTENT_LIMIT = 16_384;
const SEARCH_SNIPPET_LIMIT = 1_000;

function utf8Prefix(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return value;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let end = maxBytes; end > Math.max(0, maxBytes - 4); end -= 1) {
    try { return decoder.decode(bytes.subarray(0, end)); } catch {}
  }
  return "";
}

export function mapMemoryDatabaseError(error: unknown): MemoryServiceError {
  if (error instanceof MemoryServiceError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("operation_claim_lost") ||
    message.includes("memory_revisions_owner_operation_uq") ||
    message.includes("memory_revisions.owner_id, memory_revisions.operation_id") ||
    message.includes("operation_receipts.owner_id, operation_receipts.operation_id")
  ) {
    return new MemoryServiceError("OPERATION_CONFLICT", "operation_id has already been used");
  }
  if (
    message.includes("revision_conflict") ||
    message.includes("canonical_stage_claim_lost") ||
    message.includes("memory_revisions_memory_revision_uq") ||
    message.includes("UNIQUE constraint failed: memory_revisions.memory_id")
  ) {
    return new MemoryServiceError("REVISION_CONFLICT", "Memory revision changed concurrently");
  }
  return new MemoryServiceError("INTERNAL_ERROR", "Memory persistence failed");
}

export class MemoryPersistence {
  constructor(
    private readonly db: D1Database,
    private readonly actor: ActorContext,
  ) {}

  private revisionStatement(input: {
    id: string;
    memoryId: string;
    revision: number;
    action: "upsert" | "delete";
    objectKey: string | null;
    canonicalStageToken?: string;
    contentHash: string;
    operationId?: string;
    operationHash: string;
    now: number;
  }): D1PreparedStatement {
    return this.db
      .prepare(
        "INSERT INTO memory_revisions (id, owner_id, memory_id, revision, action, object_key, canonical_stage_token, content_hash, operation_id, operation_hash, actor_id, auth_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        input.id,
        this.actor.ownerId,
        input.memoryId,
        input.revision,
        input.action,
        input.objectKey,
        input.canonicalStageToken ?? null,
        input.contentHash,
        input.operationId ?? null,
        input.operationId ? input.operationHash : null,
        this.actor.actorId,
        this.actor.authKind,
        input.now,
      );
  }

  private outboxStatement(input: {
    id: string;
    action: "upsert" | "delete";
    memoryId: string;
    revision: number;
    operationId?: string;
    contentHash: string;
    now: number;
  }): D1PreparedStatement {
    return this.db
      .prepare(
        "INSERT INTO index_outbox (id, action, memory_id, revision, status, attempts, next_attempt_at, operation_id, content_hash, created_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)",
      )
      .bind(input.id, input.action, input.memoryId, input.revision, input.now, input.operationId ?? null, input.contentHash, input.now);
  }

  async storeStatements(input: {
    projectId: string;
    memoryId: string;
    project: string;
    namespace: string;
    key: string;
    revision: number;
    currentRevision: number;
    objectKey: string;
    writeToken: string;
    preparedMemory: PreparedMemory;
    operationId?: string;
    operationHash: string;
    indexable: boolean;
    now: number;
  }): Promise<D1PreparedStatement[]> {
    const revisionId = await opaqueId("rev", input.memoryId, String(input.revision));
    const graphStatements = input.indexable
      ? [
          this.db.prepare("DELETE FROM memory_links WHERE source_memory_id = ?").bind(input.memoryId),
          ...await memoryLinkInsertStatements(this.db, {
            sourceMemoryId: input.memoryId,
            sourceRevision: input.revision,
            projectId: input.projectId,
            namespace: input.namespace,
            links: input.preparedMemory.linkExtraction.links,
          }),
          this.db
            .prepare("INSERT INTO memory_link_index (memory_id, revision, extractor_version, status, truncated, attempts, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(memory_id) DO UPDATE SET revision = excluded.revision, extractor_version = excluded.extractor_version, status = excluded.status, truncated = excluded.truncated, attempts = excluded.attempts, next_attempt_at = excluded.next_attempt_at")
            .bind(
              input.memoryId,
              input.revision,
              MEMORY_LINK_EXTRACTOR_VERSION,
              input.preparedMemory.linkExtraction.status,
              input.preparedMemory.linkExtraction.truncated ? 1 : 0,
              input.preparedMemory.linkExtraction.status === "failed" ? 1 : 0,
              input.now,
            ),
        ]
      : [
          this.db.prepare("DELETE FROM memory_links WHERE source_memory_id = ?").bind(input.memoryId),
          this.db.prepare("DELETE FROM memory_link_index WHERE memory_id = ?").bind(input.memoryId),
        ];
    const derivedStatements = input.indexable
      ? [
          this.db.prepare("DELETE FROM memory_tags WHERE memory_id = ?").bind(input.memoryId),
          ...input.preparedMemory.tags.map((tag) => this.db.prepare("INSERT INTO memory_tags (memory_id, tag) VALUES (?, ?)").bind(input.memoryId, tag)),
          this.db
            .prepare(
              "INSERT INTO memory_search_docs (memory_id, project_id, namespace, revision, key, tags, kind, status, content, snippet, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(memory_id) DO UPDATE SET revision = excluded.revision, key = excluded.key, tags = excluded.tags, kind = excluded.kind, status = excluded.status, content = excluded.content, snippet = excluded.snippet, updated_at = excluded.updated_at",
            )
            .bind(
              input.memoryId,
              input.projectId,
              input.namespace,
              input.revision,
              input.key,
              input.preparedMemory.tags.join(" "),
              input.preparedMemory.kind ?? null,
              input.preparedMemory.status,
              utf8Prefix(input.preparedMemory.body, SEARCH_CONTENT_LIMIT),
              utf8Prefix(input.preparedMemory.body, SEARCH_SNIPPET_LIMIT),
              input.now,
            ),
          this.outboxStatement({
            id: await opaqueId("out", input.memoryId, String(input.revision), "upsert"),
            action: "upsert",
            memoryId: input.memoryId,
            revision: input.revision,
            operationId: input.operationId,
            contentHash: input.preparedMemory.hash,
            now: input.now,
          }),
        ]
      : [
          this.db.prepare("DELETE FROM memory_tags WHERE memory_id = ?").bind(input.memoryId),
          this.db.prepare("DELETE FROM memory_search_docs WHERE memory_id = ?").bind(input.memoryId),
          this.db.prepare("DELETE FROM semantic_vectors WHERE memory_id = ?").bind(input.memoryId),
          this.db.prepare("DELETE FROM index_outbox WHERE memory_id = ?").bind(input.memoryId),
        ];
    return [
      this.db.prepare("INSERT OR IGNORE INTO projects (id, owner_id, slug, created_at) VALUES (?, ?, ?, ?)").bind(input.projectId, this.actor.ownerId, input.project, input.now),
      this.db
        .prepare("INSERT OR IGNORE INTO memories (id, project_id, namespace, key, current_revision, status, deleted, indexable, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'stable', 0, ?, ?, ?)")
        .bind(input.memoryId, input.projectId, input.namespace, input.key, input.indexable ? 1 : 0, input.now, input.now),
      this.revisionStatement({
        id: revisionId,
        memoryId: input.memoryId,
        revision: input.revision,
        action: "upsert",
        objectKey: input.objectKey,
        canonicalStageToken: input.writeToken,
        contentHash: input.preparedMemory.hash,
        operationId: input.operationId,
        operationHash: input.operationHash,
        now: input.now,
      }),
      ...input.preparedMemory.attachmentIds.map((attachmentId) =>
        this.db.prepare("INSERT INTO memory_revision_attachments (memory_revision_id, attachment_id) VALUES (?, ?)").bind(revisionId, attachmentId),
      ),
      this.db
        .prepare("UPDATE memories SET current_revision = ?, current_object_key = ?, current_hash = ?, kind = ?, status = ?, deleted = 0, updated_at = ? WHERE id = ? AND current_revision = ? AND EXISTS (SELECT 1 FROM canonical_object_staging WHERE object_key = ? AND memory_id = ? AND revision = ? AND write_token = ? AND status = 'processing' AND claim_token = ?)")
        .bind(input.revision, input.objectKey, input.preparedMemory.hash, input.preparedMemory.kind ?? null, input.preparedMemory.status, input.now, input.memoryId, input.currentRevision, input.objectKey, input.memoryId, input.revision, input.writeToken, input.writeToken),
      this.db.prepare("DELETE FROM canonical_object_staging WHERE object_key = ? AND memory_id = ? AND revision = ? AND write_token = ? AND status = 'processing' AND claim_token = ?")
        .bind(input.objectKey, input.memoryId, input.revision, input.writeToken, input.writeToken),
      ...derivedStatements,
      ...graphStatements,
    ];
  }

  async deleteStatements(input: {
    memoryId: string;
    revision: number;
    currentRevision: number;
    tombstoneHash: string;
    operationId?: string;
    operationHash: string;
    indexable: boolean;
    now: number;
  }): Promise<D1PreparedStatement[]> {
    const revisionId = await opaqueId("rev", input.memoryId, String(input.revision));
    const derivedStatements = input.indexable
      ? [
          this.db.prepare("DELETE FROM memory_tags WHERE memory_id = ?").bind(input.memoryId),
          this.db.prepare("DELETE FROM memory_search_docs WHERE memory_id = ?").bind(input.memoryId),
          this.outboxStatement({
            id: await opaqueId("out", input.memoryId, String(input.revision), "delete"),
            action: "delete",
            memoryId: input.memoryId,
            revision: input.revision,
            operationId: input.operationId,
            contentHash: input.tombstoneHash,
            now: input.now,
          }),
        ]
      : [
          this.db.prepare("DELETE FROM memory_tags WHERE memory_id = ?").bind(input.memoryId),
          this.db.prepare("DELETE FROM memory_search_docs WHERE memory_id = ?").bind(input.memoryId),
          this.db.prepare("DELETE FROM semantic_vectors WHERE memory_id = ?").bind(input.memoryId),
          this.db.prepare("DELETE FROM index_outbox WHERE memory_id = ?").bind(input.memoryId),
        ];
    return [
      this.revisionStatement({
        id: revisionId,
        memoryId: input.memoryId,
        revision: input.revision,
        action: "delete",
        objectKey: null,
        contentHash: input.tombstoneHash,
        operationId: input.operationId,
        operationHash: input.operationHash,
        now: input.now,
      }),
      this.db
        .prepare("UPDATE memories SET current_revision = ?, current_object_key = NULL, current_hash = ?, deleted = 1, updated_at = ? WHERE id = ? AND current_revision = ?")
        .bind(input.revision, input.tombstoneHash, input.now, input.memoryId, input.currentRevision),
      ...derivedStatements,
      this.db.prepare("DELETE FROM memory_links WHERE source_memory_id = ?").bind(input.memoryId),
      this.db.prepare("DELETE FROM memory_link_index WHERE memory_id = ?").bind(input.memoryId),
    ];
  }

  async batch(statements: D1PreparedStatement[]): Promise<void> {
    try {
      await this.db.batch(statements);
    } catch (error) {
      throw mapMemoryDatabaseError(error);
    }
  }
}
