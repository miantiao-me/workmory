import type { AttachmentObjectStore } from "../storage/attachment-object-store";
import { retryDelay } from "../shared/maintenance-retry";
import { markAttachmentDeleted } from "./attachment-persistence";
import {
  ATTACHMENT_DELETE_LEASE_MS,
  ATTACHMENT_PROCESSING_TIMEOUT_MS,
  ATTACHMENT_QUARANTINE_MS,
  MEMORY_SOURCE_RETENTION_MS,
} from "./policy";


interface DeleteCandidate {
  id: string;
  originalR2Key: string;
  markdownR2Key: string | null;
  attempts: number;
}

export class AttachmentCleanup {
  constructor(
    private readonly db: D1Database,
    private readonly objectStore: AttachmentObjectStore,
    private readonly now: () => number = Date.now,
  ) {}

  async cleanupStale(now = this.now()): Promise<{ markedFailed: number; deleted: number }> {
    const marked = await this.db.prepare(
      `UPDATE attachments SET status = 'failed', error_code = 'PROCESSING_TIMEOUT', quarantine_at = ?, updated_at = ?
       WHERE status = 'processing' AND updated_at <= ?`,
    ).bind(now + ATTACHMENT_QUARANTINE_MS, now, now - ATTACHMENT_PROCESSING_TIMEOUT_MS).run();
    await this.db.prepare(
      `UPDATE attachments SET status = 'deleting', error_code = 'OBJECT_DELETE_PENDING', deleted_at = ?, updated_at = ?
       WHERE ((status = 'failed' AND quarantine_at <= ?)
          OR (status = 'ready' AND lifecycle = 'memory_source' AND updated_at <= ?))
         AND NOT EXISTS (SELECT 1 FROM memory_revision_attachments mra WHERE mra.attachment_id = attachments.id)`,
    ).bind(now, now, now, now - MEMORY_SOURCE_RETENTION_MS).run();

    const deleting = await this.db.prepare(
      `SELECT id, original_r2_key AS originalR2Key, markdown_r2_key AS markdownR2Key, delete_attempts AS attempts
       FROM attachments WHERE status = 'deleting' AND delete_next_attempt_at <= ?
         AND (delete_claim_token IS NULL OR delete_claimed_at IS NULL OR delete_claimed_at <= ?)
       ORDER BY updated_at, id LIMIT 10`,
    ).bind(now, now - ATTACHMENT_DELETE_LEASE_MS).all<DeleteCandidate>();
    let deleted = 0;
    for (const attachment of deleting.results) {
      const token = crypto.randomUUID();
      const claim = await this.db.prepare(
        `UPDATE attachments SET delete_claim_token = ?, delete_claimed_at = ? WHERE id = ? AND status = 'deleting'
         AND delete_next_attempt_at <= ? AND (delete_claim_token IS NULL OR delete_claimed_at IS NULL OR delete_claimed_at <= ?)`,
      ).bind(token, now, attachment.id, now, now - ATTACHMENT_DELETE_LEASE_MS).run();
      if ((claim.meta.changes ?? 0) !== 1) continue;
      try {
        await this.objectStore.delete([attachment.originalR2Key, ...(attachment.markdownR2Key ? [attachment.markdownR2Key] : [])]);
        deleted += await markAttachmentDeleted(this.db, attachment.id, token, now);
      } catch {
        const attempts = Number(attachment.attempts) + 1;
        const delay = retryDelay(attempts);
        await this.db.prepare(
          `UPDATE attachments SET delete_attempts = ?, delete_next_attempt_at = ?, delete_claim_token = NULL, delete_claimed_at = NULL
           WHERE id = ? AND status = 'deleting' AND delete_claim_token = ?`,
        ).bind(attempts, now + delay, attachment.id, token).run();
      }
    }
    return { markedFailed: marked.meta.changes ?? 0, deleted };
  }
}
