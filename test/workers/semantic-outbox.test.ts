import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryService } from "../../server/application/d1-memory-service";
import { enqueueSemanticReindex, processPendingOutbox } from "../../server/search/outbox-processor";
import { processVectorCleanup, VECTOR_CLEANUP_LEASE_MS, VECTOR_TOMBSTONE_REDELETE_MS } from "../../server/search/vector-cleanup";
import { accessActor, deferred, resetTestEnv, testEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";
import {
  semanticRuntime,
  vectorIds,
} from "./semantic-search-helpers";

beforeEach(resetTestEnv);

describe("semantic outbox", () => {
  it("orders due vector tombstones before rescheduled rows while keeping the batch at ten", async () => {
    const { vectors } = semanticRuntime();
    for (let index = 1; index <= 11; index += 1) {
      await testEnv.DB.prepare(
        `INSERT INTO vector_cleanup
         (id, vector_id, status, attempts, next_attempt_at, retain_tombstone, created_at)
         VALUES (?, ?, 'pending', 0, 0, 1, ?)`,
      ).bind(`cleanup-${String(index).padStart(2, "0")}`, `fair-vector-${index}`, index).run();
      vectors.values.set(`fair-vector-${index}`, [1, 2, 3]);
    }
    const now = 10_000;
    expect((await processVectorCleanup(testEnv.DB, vectors, 10, () => now)).claimed).toBe(10);
    expect(vectors.deleteCalls).toBe(10);
    expect((await processVectorCleanup(testEnv.DB, vectors, 10, () => now)).claimed).toBe(1);
    expect(vectors.deleteCalls).toBe(11);
    expect(vectors.values.size).toBe(0);
  });

  it("cleans a stale upsert after memory advances and settles a late Vectorize write", async () => {
    const { runtime, vectors } = semanticRuntime();
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "semantic/stale", source: { content: "first" } });
    const entered = deferred();
    const release = deferred();
    vectors.beforeUpsert = async () => { entered.resolve(); await release.promise; };
    const stale = processPendingOutbox(testEnv.DB, runtime, 1);
    await entered.promise;
    await memory.store({ project: "workmory", namespace: "default", key: "semantic/stale", source: { content: "second" } });
    release.resolve();
    await stale;
    await processVectorCleanup(testEnv.DB, vectors, 10);
    expect(vectors.values.size).toBe(0);
    expect(await testEnv.DB.prepare("SELECT count(*) AS count FROM vector_staging").first()).toEqual({ count: 0 });
    const cleanup = await testEnv.DB.prepare("SELECT vector_id AS vectorId, next_attempt_at AS nextAttemptAt FROM vector_cleanup").first<{ vectorId: string; nextAttemptAt: number }>();
    expect(cleanup).not.toBeNull();
    vectors.values.set(cleanup!.vectorId, [1, 2, 3]);
    await processVectorCleanup(testEnv.DB, vectors, 10, () => Number(cleanup!.nextAttemptAt) + VECTOR_CLEANUP_LEASE_MS);
    expect(vectors.values.size).toBe(0);
    const tombstone = await testEnv.DB.prepare("SELECT next_attempt_at AS nextAttemptAt, retain_tombstone AS retain FROM vector_cleanup").first<{ nextAttemptAt: number; retain: number }>();
    expect(tombstone?.retain).toBe(1);
    vectors.values.set(cleanup!.vectorId, [1, 2, 3]);
    await processVectorCleanup(testEnv.DB, vectors, 10, () => Number(tombstone!.nextAttemptAt) + VECTOR_TOMBSTONE_REDELETE_MS);
    expect(vectors.values.size).toBe(0);
    expect(await testEnv.DB.prepare("SELECT retain_tombstone AS retain FROM vector_cleanup").first()).toEqual({ retain: 1 });
  });

  it("does not abandon staging solely because the same outbox claim is old and no cascade removes it", async () => {
    const { vectors } = semanticRuntime();
    await memoryService().store({ project: "workmory", namespace: "default", key: "semantic/staging", source: { content: "body" } });
    const outbox = await testEnv.DB.prepare("SELECT id, memory_id AS memoryId FROM index_outbox").first<{ id: string; memoryId: string }>();
    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE index_outbox SET status = 'processing', claim_token = 'same-claim', claimed_at = 1 WHERE id = ?").bind(outbox!.id),
      testEnv.DB.prepare("INSERT INTO vector_staging (vector_id, outbox_id, memory_id, revision, claim_token, created_at) VALUES ('staged-vector', ?, ?, 1, 'same-claim', 1)").bind(outbox!.id, outbox!.memoryId),
    ]);
    await processVectorCleanup(testEnv.DB, vectors, 10, () => VECTOR_CLEANUP_LEASE_MS * 10);
    expect(await testEnv.DB.prepare("SELECT vector_id AS vectorId FROM vector_staging").first()).toEqual({ vectorId: "staged-vector" });
    await testEnv.DB.prepare("DELETE FROM index_outbox WHERE id = ?").bind(outbox!.id).run();
    expect(await testEnv.DB.prepare("SELECT vector_id AS vectorId FROM vector_staging").first()).toEqual({ vectorId: "staged-vector" });
  });

  it("indexes an upsert with model metadata and idempotently replaces updates", async () => {
    const { runtime, embeddings, vectors } = semanticRuntime();
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "semantic/item", source: { content: "first version" } });
    expect(await processPendingOutbox(testEnv.DB, runtime, 10)).toMatchObject({ succeeded: 1, failed: 0 });
    const first = await testEnv.DB.prepare("SELECT revision, model, dimensions, index_version AS indexVersion, mutation_id AS mutationId FROM semantic_vectors").first<Record<string, unknown>>();
    expect(first).toMatchObject({ revision: 1, model: "fake-multilingual", dimensions: 3, indexVersion: "test-v1" });
    expect(String(first?.mutationId)).toContain("upsert-");
    const [vectorId] = await vectorIds();
    expect(new TextEncoder().encode(vectorId).byteLength).toBeLessThanOrEqual(64);
    await memory.store({ project: "workmory", namespace: "default", key: "semantic/item", source: { content: "second version" } });
    await processPendingOutbox(testEnv.DB, runtime, 10);
    await processVectorCleanup(testEnv.DB, vectors, 10);
    const [updatedVectorId] = await vectorIds();
    expect(updatedVectorId).not.toBe(vectorId);
    expect(vectors.values.size).toBe(1);
    expect((await testEnv.DB.prepare("SELECT vector_id AS vectorId, retain_tombstone AS retain FROM vector_cleanup ORDER BY vector_id").all()).results).toEqual([]);
    expect(embeddings.documentCalls.at(-1)).toContain("second version");
    expect((await testEnv.DB.prepare("SELECT revision FROM semantic_vectors").first<{ revision: number }>())?.revision).toBe(2);
  });

  it("never deletes a vector referenced by the authoritative projection", async () => {
    const { runtime, vectors } = semanticRuntime();
    await memoryService().store({ project: "workmory", namespace: "default", key: "semantic/current", source: { content: "current" } });
    await processPendingOutbox(testEnv.DB, runtime, 10);
    const [currentId] = await vectorIds();
    await testEnv.DB.prepare(
      `INSERT INTO vector_cleanup (id, vector_id, status, attempts, next_attempt_at, retain_tombstone, created_at)
       VALUES ('current-cleanup', ?, 'pending', 0, 0, 1, 0)`,
    ).bind(currentId).run();
    const deletes = vectors.deleteCalls;
    await processVectorCleanup(testEnv.DB, vectors, 10, () => Date.now() + VECTOR_TOMBSTONE_REDELETE_MS);
    expect(vectors.deleteCalls).toBe(deletes);
    expect(vectors.values.has(currentId)).toBe(true);
    expect(await testEnv.DB.prepare("SELECT 1 FROM vector_cleanup WHERE id = 'current-cleanup'").first()).toBeNull();
  });

  it("processes deletes and keeps accepted mutations idempotent", async () => {
    const { runtime, vectors } = semanticRuntime();
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "semantic/delete", source: { content: "delete later" } });
    await processPendingOutbox(testEnv.DB, runtime, 10);
    expect(vectors.values.size).toBe(1);
    await memory.delete({ project: "workmory", namespace: "default", key: "semantic/delete" });
    await processPendingOutbox(testEnv.DB, runtime, 10);
    await processVectorCleanup(testEnv.DB, vectors, 10);
    expect(vectors.values.size).toBe(0);
    expect(await vectorIds()).toEqual([]);
    expect((await testEnv.DB.prepare("SELECT count(*) AS count FROM index_outbox WHERE status = 'done'").first<{ count: number }>())?.count).toBe(2);
  });

  it("retries failed indexing with bounded error state", async () => {
    const { runtime, embeddings } = semanticRuntime();
    await memoryService().store({ project: "workmory", namespace: "default", key: "semantic/retry", source: { content: "retry me" } });
    embeddings.fail = true;
    expect(await processPendingOutbox(testEnv.DB, runtime, 10)).toMatchObject({ failed: 1 });
    const failed = await testEnv.DB.prepare("SELECT status, attempts, last_error AS lastError, next_attempt_at AS nextAttemptAt FROM index_outbox").first<Record<string, unknown>>();
    expect(failed).toMatchObject({ status: "pending", attempts: 1, lastError: "embedding failed" });
    expect(Number(failed?.nextAttemptAt)).toBeGreaterThan(Date.now());
    embeddings.fail = false;
    await testEnv.DB.prepare("UPDATE index_outbox SET next_attempt_at = 0").run();
    expect(await processPendingOutbox(testEnv.DB, runtime, 10)).toMatchObject({ succeeded: 1 });
  });

  it("defers indexing and semantic failures never fail memory writes", async () => {
    const { runtime, embeddings } = semanticRuntime();
    embeddings.fail = true;
    const deferredWork: Promise<unknown>[] = [];
    const memory = createMemoryService({ DB: testEnv.DB, BUCKET: testEnv.BUCKET }, accessActor("subject-a"), { semantic: runtime, defer: (promise) => deferredWork.push(promise) });
    await expect(memory.store({ project: "workmory", namespace: "default", key: "deferred/item", source: { content: "durable first" } })).resolves.toMatchObject({ revision: 1 });
    expect(deferredWork).toHaveLength(1);
    await Promise.all(deferredWork);
    expect(await testEnv.DB.prepare("SELECT status, attempts FROM index_outbox").first()).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("discards a delayed stale upsert after the memory advances", async () => {
    const { runtime, vectors } = semanticRuntime();
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "race/upsert", source: { content: "revision one" } });
    const entered = deferred();
    const release = deferred();
    vectors.beforeUpsert = async () => { entered.resolve(); await release.promise; };
    const first = processPendingOutbox(testEnv.DB, runtime, 1);
    await entered.promise;
    await memory.store({ project: "workmory", namespace: "default", key: "race/upsert", source: { content: "revision two" } });
    release.resolve();
    expect(await first).toMatchObject({ succeeded: 0 });
    expect(await vectorIds()).toEqual([]);
    vectors.beforeUpsert = undefined;
    expect(await processPendingOutbox(testEnv.DB, runtime, 10)).toMatchObject({ succeeded: 1 });
    expect((await testEnv.DB.prepare("SELECT revision FROM semantic_vectors").first<{ revision: number }>())?.revision).toBe(2);
  });

  it("cannot commit semantic state after its claim token is replaced", async () => {
    const { runtime, vectors } = semanticRuntime();
    await memoryService().store({ project: "workmory", namespace: "default", key: "race/claim", source: { content: "claim me" } });
    const entered = deferred();
    const release = deferred();
    vectors.beforeUpsert = async () => { entered.resolve(); await release.promise; };
    const processing = processPendingOutbox(testEnv.DB, runtime, 1);
    await entered.promise;
    await testEnv.DB.prepare("UPDATE index_outbox SET claim_token = 'replacement-token', claimed_at = ? WHERE status = 'processing'").bind(Date.now()).run();
    release.resolve();
    expect(await processing).toMatchObject({ succeeded: 0, failed: 0 });
    await processVectorCleanup(testEnv.DB, vectors, 10);
    expect(await vectorIds()).toEqual([]);
    expect(vectors.values.size).toBe(0);
    expect(await testEnv.DB.prepare("SELECT status, claim_token AS claimToken FROM index_outbox").first()).toMatchObject({ status: "processing", claimToken: "replacement-token" });
  });

  it("delete uses its vector snapshot and cannot remove a recreated revision", async () => {
    const { runtime, vectors } = semanticRuntime();
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "race/delete", source: { content: "original" } });
    await processPendingOutbox(testEnv.DB, runtime, 10);
    await memory.delete({ project: "workmory", namespace: "default", key: "race/delete" });
    // Process the delete outbox entry to create the cleanup record.
    await processPendingOutbox(testEnv.DB, runtime, 10);
    const entered = deferred();
    const release = deferred();
    vectors.beforeDelete = async () => { entered.resolve(); await release.promise; };
    // Vector cleanup calls vectors.delete() which triggers beforeDelete.
    const deleting = processVectorCleanup(testEnv.DB, vectors, 10);
    await entered.promise;
    await memory.store({ project: "workmory", namespace: "default", key: "race/delete", source: { content: "recreated" } });
    const reindexing = processPendingOutbox(testEnv.DB, runtime, 10);
    release.resolve();
    await Promise.all([deleting, reindexing]);
    const semantic = await testEnv.DB.prepare("SELECT sv.revision, sv.vector_id AS vectorId FROM semantic_vectors sv JOIN memories m ON m.id = sv.memory_id WHERE m.key = 'race/delete'").first<{ revision: number; vectorId: string }>();
    expect(semantic?.revision).toBe(3);
    expect(vectors.values.has(String(semantic?.vectorId))).toBe(true);
  });

  it("reindex advances more than 1000 rows in one set-based statement and preserves live claims", async () => {
    await testEnv.DB.prepare("INSERT INTO projects (id, owner_id, slug, created_at) VALUES ('bulk-project', 'bulk-owner', 'bulk', 0)").run();
    await testEnv.DB.prepare(
      `WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 1205)
       INSERT INTO memories
       (id, project_id, namespace, key, current_revision, current_hash, status, deleted, created_at, updated_at)
       SELECT 'bulk-' || value, 'bulk-project', 'default', 'key-' || value, 1, 'hash-' || value, 'stable', 0, 0, 0 FROM n`,
    ).run();
    expect(await enqueueSemanticReindex(testEnv.DB)).toEqual({ enqueued: 1205 });
    const claims = await testEnv.DB.prepare("SELECT id FROM index_outbox ORDER BY id LIMIT 2").all<{ id: string }>();
    const [live, malformed] = claims.results;
    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE index_outbox SET status = 'processing', claim_token = 'live-claim', claimed_at = ? WHERE id = ?").bind(Date.now(), live.id),
      testEnv.DB.prepare("UPDATE index_outbox SET status = 'processing', claim_token = NULL, claimed_at = NULL WHERE id = ?").bind(malformed.id),
    ]);
    expect(await enqueueSemanticReindex(testEnv.DB)).toEqual({ enqueued: 1204 });
    expect(await testEnv.DB.prepare("SELECT status, claim_token AS claimToken FROM index_outbox WHERE id = ?").bind(live.id).first()).toMatchObject({ status: "processing", claimToken: "live-claim" });
    expect(await testEnv.DB.prepare("SELECT status, claim_token AS claimToken, claimed_at AS claimedAt FROM index_outbox WHERE id = ?").bind(malformed.id).first()).toMatchObject({ status: "pending", claimToken: null, claimedAt: null });
  });
});
