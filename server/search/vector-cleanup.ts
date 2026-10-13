import type { VectorIndex } from "./types";
import { retryDelay, retryErrorMessage } from "../shared/maintenance-retry";

export const VECTOR_CLEANUP_LEASE_MS = 5 * 60_000;
export const VECTOR_TOMBSTONE_REDELETE_MS = 60 * 60_000;

interface Candidate { id: string; vectorId: string; attempts: number; retainTombstone: number }

export interface VectorCleanupResult { claimed: number; succeeded: number; failed: number }

export async function processVectorCleanup(
  db: D1Database,
  vectors: VectorIndex,
  requestedLimit = 10,
  now: () => number = Date.now,
): Promise<VectorCleanupResult> {
  const limit = Math.min(10, Math.max(1, Math.trunc(requestedLimit)));
  const at = now();
  await db.batch([
    db.prepare(
      `INSERT INTO vector_cleanup (id, vector_id, status, attempts, next_attempt_at, retain_tombstone, created_at)
       SELECT 'vcl_' || lower(hex(randomblob(16))), s.vector_id, 'pending', 0, ?, 1, s.created_at
       FROM vector_staging s LEFT JOIN index_outbox o ON o.id = s.outbox_id
       WHERE o.id IS NULL OR o.status <> 'processing' OR o.claim_token IS NOT s.claim_token
       ORDER BY s.created_at, s.vector_id LIMIT ?
       ON CONFLICT(vector_id) DO NOTHING`,
    ).bind(at, limit),
    db.prepare(
      `DELETE FROM vector_staging WHERE EXISTS (
         SELECT 1 FROM vector_cleanup c WHERE c.vector_id = vector_staging.vector_id
       ) AND (NOT EXISTS (SELECT 1 FROM index_outbox o WHERE o.id = vector_staging.outbox_id)
         OR EXISTS (SELECT 1 FROM index_outbox o WHERE o.id = vector_staging.outbox_id
           AND (o.status <> 'processing' OR o.claim_token IS NOT vector_staging.claim_token)))`,
    ),
  ]);
  const rows = await db.prepare(
    `SELECT id, vector_id AS vectorId, attempts, retain_tombstone AS retainTombstone FROM vector_cleanup
     WHERE (status = 'pending' AND next_attempt_at <= ?)
        OR (status = 'processing' AND (claim_token IS NULL OR claimed_at IS NULL OR claimed_at <= ?))
     ORDER BY next_attempt_at, created_at, id LIMIT ?`,
  ).bind(at, at - VECTOR_CLEANUP_LEASE_MS, limit).all<Candidate>();
  let claimed = 0; let succeeded = 0; let failed = 0;
  for (const row of rows.results) {
    const token = crypto.randomUUID();
    const claim = await db.prepare(
      `UPDATE vector_cleanup SET status = 'processing', claim_token = ?, claimed_at = ? WHERE id = ?
       AND ((status = 'pending' AND next_attempt_at <= ?) OR (status = 'processing' AND (claim_token IS NULL OR claimed_at IS NULL OR claimed_at <= ?)))`,
    ).bind(token, at, row.id, at, at - VECTOR_CLEANUP_LEASE_MS).run();
    if ((claim.meta.changes ?? 0) !== 1) continue;
    claimed += 1;
    try {
      const referenced = await db.prepare("SELECT 1 FROM semantic_vectors WHERE vector_id = ? LIMIT 1").bind(row.vectorId).first();
      if (referenced) {
        const done = await db.prepare("DELETE FROM vector_cleanup WHERE id = ? AND status = 'processing' AND claim_token = ?")
          .bind(row.id, token).run();
        if ((done.meta.changes ?? 0) === 1) succeeded += 1;
        continue;
      }
      await vectors.delete(row.vectorId);
      // Abandoned producers can finish arbitrarily late, so their opaque IDs remain durable delete tombstones.
      const done = Number(row.retainTombstone) === 0
        ? await db.prepare("DELETE FROM vector_cleanup WHERE id = ? AND status = 'processing' AND claim_token = ?")
          .bind(row.id, token).run()
        : await db.prepare(
          `UPDATE vector_cleanup SET status = 'pending', next_attempt_at = ?,
             claim_token = NULL, claimed_at = NULL, last_error = NULL
           WHERE id = ? AND status = 'processing' AND claim_token = ?`,
        ).bind(now() + VECTOR_TOMBSTONE_REDELETE_MS, row.id, token).run();
      if ((done.meta.changes ?? 0) === 1) succeeded += 1;
    } catch (error) {
      const attempts = Number(row.attempts) + 1;
      const delay = retryDelay(attempts);
      const message = retryErrorMessage(error);
      const retry = await db.prepare(
        `UPDATE vector_cleanup SET status = 'pending', attempts = ?, next_attempt_at = ?, last_error = ?, claim_token = NULL, claimed_at = NULL
         WHERE id = ? AND status = 'processing' AND claim_token = ?`,
      ).bind(attempts, now() + delay, message, row.id, token).run();
      if ((retry.meta.changes ?? 0) === 1) failed += 1;
    }
  }
  return { claimed, succeeded, failed };
}
