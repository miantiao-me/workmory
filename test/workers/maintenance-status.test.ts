import { beforeEach, describe, expect, it, vi } from "vitest";
import { ATTACHMENT_PROCESSING_TIMEOUT_MS as PROCESSING_TIMEOUT_MS } from "../../server/attachments/policy";
import { handleMaintenanceRequest } from "../../server/http/maintenance-handler";
import { OUTBOX_CLAIM_LEASE_MS } from "../../server/search/outbox-store";
import { VECTOR_CLEANUP_LEASE_MS } from "../../server/search/vector-cleanup";
import { CANONICAL_CLEANUP_LEASE_MS, CANONICAL_STAGING_TIMEOUT_MS } from "../../server/storage/canonical-object-cleanup";
import { httpRuntime, rootKey } from "./attachment-fixtures";
import { resetTestEnv, testEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";

beforeEach(resetTestEnv);

describe("maintenance status", () => {
  it("reports global aggregate boundaries and reindex candidates without mutation or external calls", async () => {
    const now = 2_000_000_000_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const ownerA = memoryService();
      const ownerB = memoryService({ ownerId: "subject-b", actorId: "access:subject-b", authKind: "access" });
      for (const [service, key] of [
        [ownerA, "candidate/current"],
        [ownerA, "excluded/deleted"],
        [ownerA, "excluded/non-indexable"],
        [ownerB, "excluded/null-hash"],
        [ownerB, "candidate/expired"],
        [ownerB, "excluded/malformed-claim"],
      ] as const) {
        await service.store({ project: "workmory", namespace: "default", key, source: { content: `secret-${key}` } });
      }

      await testEnv.DB.batch([
        testEnv.DB.prepare("UPDATE memories SET deleted = 1 WHERE key = ?").bind("excluded/deleted"),
        testEnv.DB.prepare("UPDATE memories SET indexable = 0 WHERE key = ?").bind("excluded/non-indexable"),
        testEnv.DB.prepare("UPDATE memories SET current_hash = NULL WHERE key = ?").bind("excluded/null-hash"),
        testEnv.DB.prepare("UPDATE memories SET indexable = 0 WHERE key = ?").bind("excluded/malformed-claim"),
        testEnv.DB.prepare("UPDATE memories SET expires_at = ? WHERE key = ?").bind(now - 1, "candidate/expired"),
        testEnv.DB.prepare("UPDATE index_outbox SET status = 'pending', attempts = 0, next_attempt_at = ? WHERE memory_id = (SELECT id FROM memories WHERE key = ?)").bind(now, "candidate/current"),
        testEnv.DB.prepare("UPDATE index_outbox SET status = 'pending', attempts = 2, next_attempt_at = ? WHERE memory_id = (SELECT id FROM memories WHERE key = ?)").bind(now + 1, "excluded/deleted"),
        testEnv.DB.prepare("UPDATE index_outbox SET status = 'processing', claim_token = 'stale-token', claimed_at = ? WHERE memory_id = (SELECT id FROM memories WHERE key = ?)").bind(now - OUTBOX_CLAIM_LEASE_MS, "excluded/non-indexable"),
        testEnv.DB.prepare("UPDATE index_outbox SET status = 'processing', claim_token = 'live-token', claimed_at = ? WHERE memory_id = (SELECT id FROM memories WHERE key = ?)").bind(now - OUTBOX_CLAIM_LEASE_MS + 1, "excluded/null-hash"),
        testEnv.DB.prepare("UPDATE index_outbox SET status = 'done' WHERE memory_id = (SELECT id FROM memories WHERE key = ?)").bind("candidate/expired"),
        testEnv.DB.prepare("UPDATE index_outbox SET status = 'processing', claim_token = NULL, claimed_at = NULL WHERE memory_id = (SELECT id FROM memories WHERE key = ?)").bind("excluded/malformed-claim"),
        testEnv.DB.prepare(
          `INSERT INTO vector_cleanup (id, vector_id, status, attempts, next_attempt_at, retain_tombstone, created_at)
           VALUES ('cleanup-due', 'opaque-cleanup-due', 'pending', 0, ?, 0, ?),
                  ('cleanup-retry', 'opaque-cleanup-retry', 'pending', 2, ?, 1, ?),
                  ('cleanup-stale', 'opaque-cleanup-stale', 'processing', 1, ?, 0, ?),
                  ('cleanup-live', 'opaque-cleanup-live', 'processing', 0, ?, 0, ?)`,
        ).bind(now, now, now + 1, now, now, now, now, now),
        testEnv.DB.prepare("UPDATE vector_cleanup SET claim_token = 'stale', claimed_at = ? WHERE id = 'cleanup-stale'")
          .bind(now - VECTOR_CLEANUP_LEASE_MS),
        testEnv.DB.prepare("UPDATE vector_cleanup SET claim_token = 'live', claimed_at = ? WHERE id = 'cleanup-live'")
          .bind(now - VECTOR_CLEANUP_LEASE_MS + 1),
        testEnv.DB.prepare(
          `INSERT INTO vector_staging (vector_id, outbox_id, memory_id, revision, claim_token, created_at)
           SELECT 'opaque-stage-active', id, memory_id, revision, 'live-token', ? FROM index_outbox
           WHERE memory_id = (SELECT id FROM memories WHERE key = 'excluded/null-hash')`,
        ).bind(now),
        testEnv.DB.prepare(
          `INSERT INTO vector_staging (vector_id, outbox_id, memory_id, revision, claim_token, created_at)
           SELECT 'opaque-stage-abandoned', id, memory_id, revision, 'old-token', ? FROM index_outbox
           WHERE memory_id = (SELECT id FROM memories WHERE key = 'candidate/current')`,
        ).bind(now),
        testEnv.DB.prepare(
          `INSERT INTO vector_staging (vector_id, outbox_id, memory_id, revision, claim_token, created_at)
           SELECT 'opaque-stage-null-claim', id, memory_id, revision, 'token', ? FROM index_outbox
           WHERE memory_id = (SELECT id FROM memories WHERE key = 'excluded/malformed-claim')`,
        ).bind(now),
        testEnv.DB.prepare(
          `INSERT INTO canonical_object_staging
           (object_key, memory_id, revision, write_token, status, attempts, next_attempt_at, claim_token, claimed_at, created_at)
           VALUES ('opaque-object-due', 'memory-a', 1, 'write-a', 'pending', 0, ?, NULL, NULL, ?),
                  ('opaque-object-retry', 'memory-b', 1, 'write-b', 'pending', 2, ?, NULL, NULL, ?),
                  ('opaque-object-stale', 'memory-c', 1, 'write-c', 'processing', 1, ?, 'stale', ?, ?),
                  ('opaque-object-live', 'memory-d', 1, 'write-d', 'processing', 0, ?, 'live', ?, ?)`,
        ).bind(
          now,
          now - CANONICAL_STAGING_TIMEOUT_MS,
          now + 1,
          now - CANONICAL_STAGING_TIMEOUT_MS,
          now,
          now - CANONICAL_CLEANUP_LEASE_MS,
          now - CANONICAL_STAGING_TIMEOUT_MS,
          now,
          now - CANONICAL_CLEANUP_LEASE_MS + 1,
          now - CANONICAL_STAGING_TIMEOUT_MS,
        ),
      ]);

      const projects = await testEnv.DB.prepare("SELECT id FROM projects ORDER BY owner_id").all<{ id: string }>();
      const insertAttachment = (id: string, projectId: string, status: string, updatedAt: number) => testEnv.DB.prepare(
        `INSERT INTO attachments
         (id, project_id, status, source_kind, source_url, filename, detected_mime, original_size,
          original_sha256, original_r2_key, actor_id, idempotency_key, fingerprint, error_code, created_at, updated_at)
         VALUES (?, ?, ?, 'url', 'https://secret.example/item', 'secret.txt', 'text/plain', 1,
                 'secret-hash', 'secret-object-key', 'secret-actor', ?, ?, 'SECRET_ERROR', ?, ?)`,
      ).bind(id, projectId, status, id, id, updatedAt, updatedAt);
      await testEnv.DB.batch([
        insertAttachment("att_stale", projects.results[0].id, "processing", now - PROCESSING_TIMEOUT_MS),
        insertAttachment("att_fresh", projects.results[1].id, "processing", now - PROCESSING_TIMEOUT_MS + 1),
        insertAttachment("att_failed", projects.results[0].id, "failed", now),
        insertAttachment("att_deleting", projects.results[1].id, "deleting", now),
        insertAttachment("att_ready", projects.results[0].id, "ready", now),
        insertAttachment("att_deleted", projects.results[1].id, "deleted", now),
      ]);
      await testEnv.BUCKET.put("status-must-not-touch", "sentinel");

      const before = await databaseSnapshot();
      const objectsBefore = await testEnv.BUCKET.list();
      const response = await handleMaintenanceRequest(
        new Request("https://api.example.com/v1/maintenance", {
          method: "POST",
          headers: { "X-API-Key": rootKey, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status" }),
        }),
        httpRuntime(),
      );
      const result = await response.json<Record<string, unknown>>();

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(result).toEqual({
        outbox: { pending: 2, due: 1, processing: 3, stale: 2, retrying: 1 },
        attachments: { processing: 2, staleProcessing: 1, failed: 1, deleting: 1 },
        reindex: { candidates: 2 },
        graph: { pending: 0, retrying: 0, truncated: 0 },
        vectorCleanup: { pending: 2, due: 1, processing: 2, stale: 1, retrying: 1 },
        vectorStaging: { total: 3, abandoned: 2 },
        canonicalObjectStaging: { pending: 2, due: 1, processing: 2, stale: 1, retrying: 1 },
      });
      expect(JSON.stringify(result)).not.toMatch(/subject-b|secret-|opaque-|https:|SECRET_ERROR/);
      expect(await databaseSnapshot()).toEqual(before);
      expect((await testEnv.BUCKET.list()).objects.map(({ key }) => key)).toEqual(objectsBefore.objects.map(({ key }) => key));
    } finally {
      clock.mockRestore();
    }
  });
});

async function databaseSnapshot() {
  const [outbox, attachments, memories, vectors, vectorCleanup, vectorStaging, canonicalObjectStaging] = await Promise.all([
    testEnv.DB.prepare("SELECT * FROM index_outbox ORDER BY id").all(),
    testEnv.DB.prepare("SELECT * FROM attachments ORDER BY id").all(),
    testEnv.DB.prepare("SELECT * FROM memories ORDER BY id").all(),
    testEnv.DB.prepare("SELECT * FROM semantic_vectors ORDER BY memory_id").all(),
    testEnv.DB.prepare("SELECT * FROM vector_cleanup ORDER BY id").all(),
    testEnv.DB.prepare("SELECT * FROM vector_staging ORDER BY vector_id").all(),
    testEnv.DB.prepare("SELECT * FROM canonical_object_staging ORDER BY object_key").all(),
  ]);
  return {
    outbox: outbox.results,
    attachments: attachments.results,
    memories: memories.results,
    vectors: vectors.results,
    vectorCleanup: vectorCleanup.results,
    vectorStaging: vectorStaging.results,
    canonicalObjectStaging: canonicalObjectStaging.results,
  };
}
