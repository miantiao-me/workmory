import { retryDelay, retryErrorMessage } from "../shared/maintenance-retry";

export const CANONICAL_STAGING_TIMEOUT_MS = 10 * 60_000;
export const CANONICAL_CLEANUP_LEASE_MS = 5 * 60_000;
export const CANONICAL_TOMBSTONE_REDELETE_MS = 60 * 60_000;

interface Candidate { objectKey: string; attempts: number }
export interface CanonicalCleanupResult { claimed: number; deleted: number; failed: number }

export class CanonicalObjectCleanup {
  constructor(private readonly db: D1Database, private readonly bucket: R2Bucket, private readonly now: () => number = Date.now) {}

  async process(requestedLimit = 10): Promise<CanonicalCleanupResult> {
    const limit = Math.min(10, Math.max(1, Math.trunc(requestedLimit)));
    const now = this.now();
    const rows = await this.db.prepare(
      `SELECT object_key AS objectKey, attempts FROM canonical_object_staging
       WHERE created_at <= ? AND ((status = 'pending' AND next_attempt_at <= ?)
          OR (status = 'processing' AND (claim_token IS NULL OR claimed_at IS NULL OR claimed_at <= ?)))
       ORDER BY next_attempt_at, created_at, object_key LIMIT ?`,
    ).bind(now - CANONICAL_STAGING_TIMEOUT_MS, now, now - CANONICAL_CLEANUP_LEASE_MS, limit).all<Candidate>();
    let claimed = 0; let deleted = 0; let failed = 0;
    for (const row of rows.results) {
      const token = crypto.randomUUID();
      const claim = await this.db.prepare(
        `UPDATE canonical_object_staging SET status = 'processing', claim_token = ?, claimed_at = ?,
           delete_confirmations = CASE WHEN delete_confirmations < 1 THEN 1 ELSE delete_confirmations END
         WHERE object_key = ? AND created_at <= ? AND ((status = 'pending' AND next_attempt_at <= ?)
           OR (status = 'processing' AND (claim_token IS NULL OR claimed_at IS NULL OR claimed_at <= ?)))`,
      ).bind(token, now, row.objectKey, now - CANONICAL_STAGING_TIMEOUT_MS, now, now - CANONICAL_CLEANUP_LEASE_MS).run();
      if ((claim.meta.changes ?? 0) !== 1) continue;
      claimed += 1;
      try {
        const referenced = await this.db.prepare(
          `SELECT 1 FROM memories WHERE current_object_key = ?
           UNION ALL SELECT 1 FROM memory_revisions WHERE object_key = ? LIMIT 1`,
        ).bind(row.objectKey, row.objectKey).first();
        if (referenced) {
          const done = await this.db.prepare(
            "DELETE FROM canonical_object_staging WHERE object_key = ? AND status = 'processing' AND claim_token = ?",
          ).bind(row.objectKey, token).run();
          if ((done.meta.changes ?? 0) === 1) deleted += 1;
          continue;
        }
        await this.bucket.delete(row.objectKey);
        // Canonical producers may finish after any fixed delete count; retain the opaque key as a durable tombstone.
        const done = await this.db.prepare(
          `UPDATE canonical_object_staging SET status = 'pending', delete_confirmations = delete_confirmations + 1,
             next_attempt_at = ?, claim_token = NULL, claimed_at = NULL, last_error = NULL
           WHERE object_key = ? AND status = 'processing' AND claim_token = ?`,
        ).bind(this.now() + CANONICAL_TOMBSTONE_REDELETE_MS, row.objectKey, token).run();
        if ((done.meta.changes ?? 0) === 1) deleted += 1;
      } catch (error) {
        const attempts = Number(row.attempts) + 1;
        const delay = retryDelay(attempts);
        const message = retryErrorMessage(error);
        const retry = await this.db.prepare(
          `UPDATE canonical_object_staging SET status = 'pending', attempts = ?, next_attempt_at = ?, last_error = ?, claim_token = NULL, claimed_at = NULL
           WHERE object_key = ? AND status = 'processing' AND claim_token = ?`,
        ).bind(attempts, this.now() + delay, message, row.objectKey, token).run();
        if ((retry.meta.changes ?? 0) === 1) failed += 1;
      }
    }
    return { claimed, deleted, failed };
  }
}
