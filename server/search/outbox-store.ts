import { retryDelay, retryErrorMessage } from "../shared/maintenance-retry";

export const OUTBOX_CLAIM_LEASE_MS = 5 * 60_000;
export const REINDEX_CANDIDATE_PREDICATE =
  "m.deleted = 0 AND m.indexable = 1 AND m.current_hash IS NOT NULL";

export function invalidProcessingClaimSql(table: "" | "index_outbox" = ""): string {
  const column = table ? `${table}.` : "";
  return `${column}status = 'processing' AND (${column}claim_token IS NULL OR ${column}claimed_at IS NULL OR ${column}claimed_at <= ?)`;
}

export interface OutboxCandidate {
  id: string;
  action: "upsert" | "delete";
  memoryId: string;
  revision: number;
  attempts: number;
  contentHash: string;
}

export interface OutboxClaim extends OutboxCandidate {
  claimToken: string;
}

function markDoneStatement(db: D1Database, claim: OutboxClaim, mutationId: string | null, processedAt: number) {
  return db
    .prepare(
      `UPDATE index_outbox SET status = 'done', mutation_id = ?, processed_at = ?, claimed_at = NULL,
         claim_token = NULL, last_error = NULL
       WHERE id = ? AND status = 'processing' AND claim_token = ?`,
    )
    .bind(mutationId, processedAt, claim.id, claim.claimToken);
}

export async function queryPendingOutbox(db: D1Database, limit: number): Promise<OutboxCandidate[]> {
  const now = Date.now();
  const candidates = await db
    .prepare(
      `SELECT id, action, memory_id AS memoryId, revision, attempts, content_hash AS contentHash
       FROM index_outbox
       WHERE (status = 'pending' AND next_attempt_at <= ?)
          OR (${invalidProcessingClaimSql()})
       ORDER BY created_at, revision LIMIT ?`,
    )
    .bind(now, now - OUTBOX_CLAIM_LEASE_MS, limit)
    .all<OutboxCandidate & Record<string, unknown>>();
  return candidates.results;
}

export async function claimOutboxCandidate(
  db: D1Database,
  candidate: OutboxCandidate,
): Promise<OutboxClaim | null> {
  const claimedAt = Date.now();
  const claimToken = crypto.randomUUID();
  const result = await db
    .prepare(
      `UPDATE index_outbox SET status = 'processing', claimed_at = ?, claim_token = ?
       WHERE id = ? AND ((status = 'pending' AND next_attempt_at <= ?)
         OR (${invalidProcessingClaimSql()}))`,
    )
    .bind(claimedAt, claimToken, candidate.id, claimedAt, claimedAt - OUTBOX_CLAIM_LEASE_MS)
    .run();
  return (result.meta.changes ?? 0) === 1 ? { ...candidate, claimToken } : null;
}

export async function markOutboxDone(
  db: D1Database,
  claim: OutboxClaim,
  mutationId: string | null,
): Promise<boolean> {
  const result = await markDoneStatement(db, claim, mutationId, Date.now()).run();
  return (result.meta.changes ?? 0) === 1;
}

export async function markOutboxFailed(
  db: D1Database,
  claim: OutboxClaim,
  error: unknown,
): Promise<boolean> {
  const attempts = claim.attempts + 1;
  const delay = retryDelay(attempts);
  const message = retryErrorMessage(error);
  const result = await db
    .prepare(
      `UPDATE index_outbox SET status = 'pending', attempts = ?, next_attempt_at = ?, last_error = ?,
         claimed_at = NULL, claim_token = NULL
       WHERE id = ? AND status = 'processing' AND claim_token = ?`,
    )
    .bind(attempts, Date.now() + delay, message, claim.id, claim.claimToken)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function commitSemanticUpsert(
  db: D1Database,
  claim: OutboxClaim,
  vector: {
    id: string;
    model: string;
    dimensions: number;
    indexVersion: string;
    mutationId: string;
  },
): Promise<boolean> {
  const indexedAt = Date.now();
  const results = await db.batch([
    // Queue replaced vectors only while this claim still owns the memory's current revision.
    db.prepare(
      `INSERT INTO vector_cleanup (id, vector_id, status, attempts, next_attempt_at, created_at)
       SELECT 'vcl_' || lower(hex(randomblob(16))), vector_id, 'pending', 0, ?, ?
       FROM semantic_vectors WHERE memory_id = ? AND vector_id <> ?
       AND EXISTS (
         SELECT 1 FROM memories m JOIN index_outbox o ON o.id = ?
         WHERE m.id = ? AND m.current_revision = ? AND m.current_hash = ? AND m.deleted = 0 AND m.indexable = 1
           AND o.status = 'processing' AND o.claim_token = ?
       )
       ON CONFLICT(vector_id) DO NOTHING`,
    ).bind(
      indexedAt, indexedAt, claim.memoryId, vector.id,
      claim.id, claim.memoryId, claim.revision, claim.contentHash, claim.claimToken,
    ),
    db.prepare(
      `INSERT INTO semantic_vectors
       (memory_id, revision, vector_id, content_hash, model, dimensions, index_version, mutation_id, indexed_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM memories m JOIN index_outbox o ON o.id = ?
         WHERE m.id = ? AND m.current_revision = ? AND m.current_hash = ? AND m.deleted = 0 AND m.indexable = 1
           AND o.status = 'processing' AND o.claim_token = ?
       )
       ON CONFLICT(memory_id) DO UPDATE SET
         revision = excluded.revision, vector_id = excluded.vector_id, content_hash = excluded.content_hash,
         model = excluded.model, dimensions = excluded.dimensions, index_version = excluded.index_version,
         mutation_id = excluded.mutation_id, indexed_at = excluded.indexed_at
       WHERE semantic_vectors.revision <= excluded.revision`,
    ).bind(
      claim.memoryId,
      claim.revision,
      vector.id,
      claim.contentHash,
      vector.model,
      vector.dimensions,
      vector.indexVersion,
      vector.mutationId,
      indexedAt,
      claim.id,
      claim.memoryId,
      claim.revision,
      claim.contentHash,
      claim.claimToken,
    ),
    db.prepare(
      `DELETE FROM vector_staging WHERE vector_id = ? AND outbox_id = ? AND claim_token = ?
       AND EXISTS (SELECT 1 FROM index_outbox WHERE id = ? AND status = 'processing' AND claim_token = ?)
       AND EXISTS (SELECT 1 FROM semantic_vectors WHERE memory_id = ? AND revision = ? AND vector_id = ?)`,
    ).bind(vector.id, claim.id, claim.claimToken, claim.id, claim.claimToken, claim.memoryId, claim.revision, vector.id),
    markDoneStatement(db, claim, vector.mutationId, indexedAt),
  ]);
  return (results[1].meta.changes ?? 0) === 1 && (results[3].meta.changes ?? 0) === 1;
}

export async function commitSemanticDelete(
  db: D1Database,
  claim: OutboxClaim,
  snapshot: { vectorId: string | null; vectorRevision: number | null },
  mutationId: string,
): Promise<boolean> {
  const processedAt = Date.now();
  const results = await db.batch([
    // Queue the removed vector only while this claim still owns the tombstoned memory.
    db.prepare(
      `INSERT INTO vector_cleanup (id, vector_id, status, attempts, next_attempt_at, created_at)
       SELECT 'vcl_' || lower(hex(randomblob(16))), vector_id, 'pending', 0, ?, ?
       FROM semantic_vectors WHERE memory_id = ? AND vector_id = ? AND revision = ?
       AND EXISTS (
         SELECT 1 FROM memories m JOIN index_outbox o ON o.id = ?
         WHERE m.id = ? AND m.current_revision = ? AND m.deleted = 1 AND m.indexable = 1
           AND o.status = 'processing' AND o.claim_token = ?
       )
       ON CONFLICT(vector_id) DO NOTHING`,
    ).bind(
      processedAt, processedAt, claim.memoryId, snapshot.vectorId, snapshot.vectorRevision,
      claim.id, claim.memoryId, claim.revision, claim.claimToken,
    ),
    db
      .prepare(
        `DELETE FROM semantic_vectors
         WHERE memory_id = ? AND vector_id = ? AND revision = ?
           AND EXISTS (
             SELECT 1 FROM memories m JOIN index_outbox o ON o.id = ?
             WHERE m.id = ? AND m.current_revision = ? AND m.deleted = 1 AND m.indexable = 1
               AND o.status = 'processing' AND o.claim_token = ?
           )`,
      )
      .bind(claim.memoryId, snapshot.vectorId, snapshot.vectorRevision, claim.id, claim.memoryId, claim.revision, claim.claimToken),
    markDoneStatement(db, claim, mutationId, processedAt),
  ]);
  return (results[2].meta.changes ?? 0) === 1;
}

export async function stageVector(db: D1Database, claim: OutboxClaim, vectorId: string): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO vector_staging (vector_id, outbox_id, memory_id, revision, claim_token, created_at)
     SELECT ?, id, memory_id, revision, claim_token, ? FROM index_outbox
     WHERE id = ? AND status = 'processing' AND claim_token = ?
     ON CONFLICT(vector_id) DO NOTHING`,
  ).bind(vectorId, Date.now(), claim.id, claim.claimToken).run();
  return (result.meta.changes ?? 0) === 1;
}

export async function queueRejectedVector(db: D1Database, claim: OutboxClaim, vectorId: string): Promise<void> {
  const now = Date.now();
  await db.batch([
    db.prepare(
      `INSERT INTO vector_cleanup (id, vector_id, status, attempts, next_attempt_at, retain_tombstone, created_at)
       VALUES ('vcl_' || lower(hex(randomblob(16))), ?, 'pending', 0, ?, 1, ?)
       ON CONFLICT(vector_id) DO NOTHING`,
    ).bind(vectorId, now, now),
    db.prepare("DELETE FROM vector_staging WHERE vector_id = ? AND outbox_id = ? AND claim_token = ?")
      .bind(vectorId, claim.id, claim.claimToken),
  ]);
}

export async function enqueueCurrentMemoriesForReindex(db: D1Database): Promise<{ enqueued: number }> {
  const now = Date.now();
  const result = await db
    .prepare(
      `INSERT INTO index_outbox
       (id, action, memory_id, revision, status, attempts, next_attempt_at, content_hash, created_at)
       SELECT 'out_' || lower(hex(randomblob(16))), 'upsert', m.id, m.current_revision,
              'pending', 0, ?, m.current_hash, ?
       FROM memories m
       WHERE ${REINDEX_CANDIDATE_PREDICATE}
       ON CONFLICT(memory_id, revision, action) DO UPDATE SET
         status = 'pending', attempts = 0, next_attempt_at = excluded.next_attempt_at,
         content_hash = excluded.content_hash, claimed_at = NULL, claim_token = NULL,
         mutation_id = NULL, processed_at = NULL, last_error = NULL
       WHERE index_outbox.status <> 'processing' OR (${invalidProcessingClaimSql("index_outbox")})`,
    )
    .bind(now, now, now - OUTBOX_CLAIM_LEASE_MS)
    .run();
  return { enqueued: result.meta.changes ?? 0 };
}
