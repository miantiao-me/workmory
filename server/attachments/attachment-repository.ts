import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { attachments, projects } from "../db/schema";
import type { ActorContext } from "../domain/identity";
import { AttachmentServiceError, type AttachmentLifecycle, type AttachmentMetadata } from "./types";
import { ATTACHMENT_DELETE_LEASE_MS } from "./policy";
import { markAttachmentDeleted } from "./attachment-persistence";

type AttachmentRecord = Pick<
  typeof attachments.$inferSelect,
  | "id"
  | "status"
  | "sourceKind"
  | "sourceUrl"
  | "filename"
  | "declaredMime"
  | "detectedMime"
  | "originalSize"
  | "originalSha256"
  | "originalR2Key"
  | "markdownSize"
  | "markdownSha256"
  | "markdownR2Key"
  | "conversionId"
  | "conversionTokens"
  | "converter"
  | "errorCode"
  | "fingerprint"
  | "createdAt"
  | "updatedAt"
>;

function attachmentMetadata(attachment: AttachmentRecord, project: string): AttachmentMetadata {
  return {
    id: attachment.id,
    project,
    status: attachment.status,
    sourceKind: attachment.sourceKind,
    sourceUrl: attachment.sourceUrl ?? undefined,
    filename: attachment.filename,
    declaredMime: attachment.declaredMime ?? undefined,
    detectedMime: attachment.detectedMime,
    originalSize: Number(attachment.originalSize),
    originalSha256: attachment.originalSha256,
    markdownSize: attachment.markdownSize === null ? undefined : Number(attachment.markdownSize),
    markdownSha256: attachment.markdownSha256 ?? undefined,
    conversionId: attachment.conversionId ?? undefined,
    conversionTokens: attachment.conversionTokens === null ? undefined : Number(attachment.conversionTokens),
    converter: attachment.converter ?? undefined,
    errorCode: attachment.errorCode ?? undefined,
    createdAt: new Date(Number(attachment.createdAt)).toISOString(),
    updatedAt: new Date(Number(attachment.updatedAt)).toISOString(),
  };
}

function requireReady(attachment: AttachmentRecord | null): AttachmentRecord {
  if (!attachment || attachment.status === "deleted") {
    throw new AttachmentServiceError("ATTACHMENT_NOT_FOUND", 404, "Attachment was not found");
  }
  if (attachment.status === "processing") {
    throw new AttachmentServiceError("ATTACHMENT_PROCESSING", 409, "Attachment is still processing");
  }
  if (attachment.status === "failed") {
    throw new AttachmentServiceError("ATTACHMENT_FAILED", 409, "Attachment processing failed");
  }
  if (attachment.status === "deleting") {
    throw new AttachmentServiceError("ATTACHMENT_NOT_READY", 409, "Attachment deletion is in progress");
  }
  return attachment;
}

export class AttachmentRepository {
  private readonly orm;

  constructor(private readonly db: D1Database, private readonly actor: ActorContext) {
    this.orm = drizzle(db, { schema: { attachments, projects } });
  }

  async find(project: string, id: string): Promise<AttachmentRecord | null> {
    const rows = await this.orm
      .select({ attachment: attachments })
      .from(attachments)
      .innerJoin(projects, eq(attachments.projectId, projects.id))
      .where(and(eq(attachments.id, id), eq(projects.ownerId, this.actor.ownerId), eq(projects.slug, project)))
      .limit(1);
    return rows[0]?.attachment ?? null;
  }

  async findReady(project: string, id: string): Promise<AttachmentRecord> { return requireReady(await this.find(project, id)); }

  metadata(attachment: AttachmentRecord, project: string): AttachmentMetadata {
    return attachmentMetadata(attachment, project);
  }

  async findByIdempotency(projectId: string, idempotencyKey: string): Promise<AttachmentRecord | null> {
    const rows = await this.orm
      .select()
      .from(attachments)
      .where(and(
        eq(attachments.projectId, projectId),
        eq(attachments.actorId, this.actor.actorId),
        eq(attachments.idempotencyKey, idempotencyKey),
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  async existingResult(
    projectId: string,
    idempotencyKey: string,
    fingerprint: string,
    project: string,
  ): Promise<AttachmentMetadata | undefined> {
    const attachment = await this.findByIdempotency(projectId, idempotencyKey);
    if (!attachment) return undefined;
    if (attachment.fingerprint !== fingerprint) {
      throw new AttachmentServiceError("IDEMPOTENCY_CONFLICT", 409, "Idempotency key was used with different input");
    }
    if (attachment.status === "ready") return { ...attachmentMetadata(attachment, project), reused: true };
    if (attachment.status === "processing") {
      throw new AttachmentServiceError("ATTACHMENT_PROCESSING", 409, "Attachment is still processing");
    }
    throw new AttachmentServiceError("ATTACHMENT_FAILED", 409, "Failed or deleted attachments require a new idempotency key");
  }

  async insertProcessing(input: {
    id: string;
    projectId: string;
    project: string;
    sourceKind: "upload" | "url";
    sourceUrl?: string;
    lifecycle?: AttachmentLifecycle;
    filename: string;
    declaredMime?: string;
    detectedMime: string;
    originalSize: number;
    originalSha256: string;
    originalR2Key: string;
    idempotencyKey: string;
    fingerprint: string;
    now: number;
  }): Promise<boolean> {
    const [, inserted] = await this.db.batch<{ id: string }>([
      this.db.prepare("INSERT INTO projects (id, owner_id, slug, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING").bind(
        input.projectId,
        this.actor.ownerId,
        input.project,
        input.now,
      ),
      this.db.prepare(
        `INSERT INTO attachments
         (id, project_id, status, source_kind, source_url, lifecycle, filename, declared_mime, detected_mime,
          original_size, original_sha256, original_r2_key, actor_id, idempotency_key, fingerprint, created_at, updated_at)
         VALUES (?, ?, 'processing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (project_id, actor_id, idempotency_key) DO NOTHING
         RETURNING id`,
      ).bind(
        input.id,
        input.projectId,
        input.sourceKind,
        input.sourceUrl ?? null,
        input.lifecycle ?? "user",
        input.filename,
        input.declaredMime?.split(";", 1)[0].trim().toLowerCase() ?? null,
        input.detectedMime,
        input.originalSize,
        input.originalSha256,
        input.originalR2Key,
        this.actor.actorId,
        input.idempotencyKey,
        input.fingerprint,
        input.now,
        input.now,
      ),
    ]);
    return inserted.results.length > 0;
  }

  async stageMarkdown(input: {
    id: string;
    markdownSize: number;
    markdownSha256: string;
    markdownR2Key: string;
    conversionId?: string;
    conversionTokens?: number;
    converter: string;
    now: number;
  }): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE attachments SET markdown_size = ?, markdown_sha256 = ?, markdown_r2_key = ?,
            conversion_id = ?, conversion_tokens = ?, converter = ?, updated_at = ?
         WHERE id = ? AND status = 'processing'`,
      )
      .bind(
        input.markdownSize,
        input.markdownSha256,
        input.markdownR2Key,
        input.conversionId ?? null,
        input.conversionTokens ?? null,
        input.converter,
        input.now,
        input.id,
      )
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async markReady(id: string, now: number): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE attachments SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'processing'")
      .bind(now, id)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async markFailed(id: string, code: string, now: number, quarantineAt: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE attachments SET status = 'failed', error_code = ?, quarantine_at = ?, updated_at = ? WHERE id = ? AND status = 'processing'",
      )
      .bind(code, quarantineAt, now, id)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async claimDeleting(id: string, now: number): Promise<string | null> {
    const token = crypto.randomUUID();
    const result = await this.db
      .prepare(
        `UPDATE attachments SET status = 'deleting', error_code = 'OBJECT_DELETE_PENDING', deleted_at = ?, updated_at = ?,
           delete_claim_token = ?, delete_claimed_at = ?
         WHERE id = ? AND ((status = 'ready'
           AND NOT EXISTS (SELECT 1 FROM memory_revision_attachments WHERE attachment_id = ?))
          OR (status = 'deleting' AND delete_next_attempt_at <= ?
            AND (delete_claim_token IS NULL OR delete_claimed_at IS NULL OR delete_claimed_at <= ?)))`,
      )
      .bind(now, now, token, now, id, id, now, now - ATTACHMENT_DELETE_LEASE_MS)
      .run();
    return (result.meta.changes ?? 0) === 1 ? token : null;
  }

  async isReferenced(id: string): Promise<boolean> {
    return Boolean(
      await this.db.prepare("SELECT 1 AS referenced FROM memory_revision_attachments WHERE attachment_id = ? LIMIT 1").bind(id).first(),
    );
  }

  async markDeleted(id: string, claimToken: string, now: number): Promise<number> {
    return markAttachmentDeleted(this.db, id, claimToken, now);
  }

  async retryDelete(id: string, claimToken: string, now: number): Promise<void> {
    await this.db.prepare(
      `UPDATE attachments SET delete_attempts = delete_attempts + 1,
         delete_next_attempt_at = ?, delete_claim_token = NULL, delete_claimed_at = NULL
       WHERE id = ? AND status = 'deleting' AND delete_claim_token = ?`,
    ).bind(now + 2_000, id, claimToken).run();
  }

}
