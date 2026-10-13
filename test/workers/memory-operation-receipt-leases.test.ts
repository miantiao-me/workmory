import { beforeEach, describe, expect, it, vi } from "vitest";
import { D1MemoryService, OPERATION_RECEIPT_LEASE_MS, createMemoryService } from "../../server/application/d1-memory-service";
import type { MemoryAttachmentSource } from "../../server/attachments/types";
import { projectOpaqueId } from "../../server/domain/identity";
import { R2ObjectStore, type ImmutableObjectStore } from "../../server/storage/r2-object-store";
import { accessActor, deferred, resetTestEnv, testEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";
import { CanonicalObjectCleanup, CANONICAL_CLEANUP_LEASE_MS, CANONICAL_STAGING_TIMEOUT_MS, CANONICAL_TOMBSTONE_REDELETE_MS } from "../../server/storage/canonical-object-cleanup";

beforeEach(resetTestEnv);

describe("memory operation receipt leases and takeover", () => {
  it("orders due canonical tombstones before rescheduled rows while keeping the batch at ten", async () => {
    for (let index = 1; index <= 11; index += 1) {
      await testEnv.DB.prepare(
        `INSERT INTO canonical_object_staging
         (object_key, memory_id, revision, write_token, status, attempts, next_attempt_at, delete_confirmations, created_at)
         VALUES (?, ?, 1, ?, 'pending', 0, 0, 1, ?)`,
      ).bind(`okf/fair-${String(index).padStart(2, "0")}.md`, `memory-${index}`, `token-${index}`, index).run();
    }
    const deleteObject = vi.fn(async () => undefined);
    const bucket = { delete: deleteObject } as unknown as R2Bucket;
    const now = CANONICAL_STAGING_TIMEOUT_MS + 100;
    const cleanup = new CanonicalObjectCleanup(testEnv.DB, bucket, () => now);
    expect((await cleanup.process(10)).claimed).toBe(10);
    expect(deleteObject).toHaveBeenCalledTimes(10);
    expect((await cleanup.process(10)).claimed).toBe(1);
    expect(deleteObject).toHaveBeenCalledTimes(11);
  });

  it("rolls back the full store batch after canonical cleanup takes over its stage", async () => {
    const base = testEnv.DB;
    const cleanup = new CanonicalObjectCleanup(base, testEnv.BUCKET, () => CANONICAL_STAGING_TIMEOUT_MS + CANONICAL_CLEANUP_LEASE_MS + 1);
    const fencedDb = {
      prepare: base.prepare.bind(base),
      batch: async (statements: D1PreparedStatement[]) => {
        await cleanup.process(10);
        return base.batch(statements);
      },
    } as unknown as D1Database;
    const memory = new D1MemoryService(fencedDb, new R2ObjectStore(testEnv.BUCKET), accessActor("subject-a"), undefined, undefined, undefined, () => 0);
    await expect(memory.store({
      project: "workmory", namespace: "default", key: "fence/canonical-stage",
      source: { content: "must roll back" }, operationId: "canonical-stage-fence",
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const state = await base.prepare(
      `SELECT (SELECT count(*) FROM memories) AS memories,
              (SELECT count(*) FROM memory_revisions) AS revisions,
              (SELECT count(*) FROM memory_search_docs) AS searchDocs,
              (SELECT count(*) FROM index_outbox) AS outbox`,
    ).first();
    expect(state).toEqual({ memories: 0, revisions: 0, searchDocs: 0, outbox: 0 });
  });

  it("permanently seals adoption when cleanup completion loses its claim and a retry fails", async () => {
    await memoryService().store({
      project: "workmory", namespace: "default", key: "fence/sealed-stage", source: { content: "current" },
    });
    const snapshot = () => testEnv.DB.prepare(
      `SELECT m.current_revision AS revision,
              (SELECT count(*) FROM memory_revisions) AS revisions,
              (SELECT count(*) FROM memory_search_docs) AS searchDocs,
              (SELECT count(*) FROM index_outbox) AS outbox
       FROM memories m WHERE m.key = 'fence/sealed-stage'`,
    ).first();
    const before = await snapshot();
    const entered = deferred();
    const release = deferred();
    const stored = new R2ObjectStore(testEnv.BUCKET);
    const delayedObjects: ImmutableObjectStore = {
      async putOkf(key, markdown, hash) {
        entered.resolve();
        await release.promise;
        await stored.putOkf(key, markdown, hash);
      },
      getOkf: (key, hash) => stored.getOkf(key, hash),
    };
    const writer = new D1MemoryService(testEnv.DB, delayedObjects, accessActor("subject-a"), undefined, undefined, undefined, () => 0);
    const writing = writer.store({
      project: "workmory", namespace: "default", key: "fence/sealed-stage",
      source: { content: "replacement" }, operationId: "sealed-stage-operation",
    });
    await entered.promise;

    const firstAt = CANONICAL_STAGING_TIMEOUT_MS + CANONICAL_CLEANUP_LEASE_MS + 1;
    const racingBucket = {
      async delete(key: string) {
        await testEnv.BUCKET.delete(key);
        await testEnv.DB.prepare(
          "UPDATE canonical_object_staging SET claim_token = 'replacement-cleanup-claim' WHERE object_key = ?",
        ).bind(key).run();
      },
    } as unknown as R2Bucket;
    expect((await new CanonicalObjectCleanup(testEnv.DB, racingBucket, () => firstAt).process(10)).deleted).toBe(0);
    expect(await testEnv.DB.prepare(
      "SELECT status, delete_confirmations AS confirmations, claim_token AS claimToken FROM canonical_object_staging",
    ).first()).toEqual({ status: "processing", confirmations: 1, claimToken: "replacement-cleanup-claim" });

    const failingBucket = { delete: async () => { throw new Error("retry failed"); } } as unknown as R2Bucket;
    await new CanonicalObjectCleanup(testEnv.DB, failingBucket, () => firstAt + CANONICAL_CLEANUP_LEASE_MS + 1).process(10);
    const sealed = await testEnv.DB.prepare(
      `SELECT object_key AS objectKey, memory_id AS memoryId, revision, write_token AS writeToken,
              status, delete_confirmations AS confirmations
       FROM canonical_object_staging`,
    ).first<{ objectKey: string; memoryId: string; revision: number; writeToken: string; status: string; confirmations: number }>();
    expect(sealed).toMatchObject({ status: "pending", confirmations: 1 });
    const staleAdoption = await testEnv.DB.prepare(
      `UPDATE canonical_object_staging SET status = 'processing', claim_token = ?, claimed_at = ?
       WHERE object_key = ? AND write_token = ? AND status = 'pending' AND delete_confirmations = 0`,
    ).bind(sealed!.writeToken, firstAt, sealed!.objectKey, sealed!.writeToken).run();
    expect(staleAdoption.meta.changes).toBe(0);

    release.resolve();
    await expect(writing).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await testEnv.DB.prepare(
      "UPDATE canonical_object_staging SET status = 'processing', claim_token = write_token WHERE object_key = ?",
    ).bind(sealed!.objectKey).run();
    await expect(testEnv.DB.prepare(
      `INSERT INTO memory_revisions
       (id, owner_id, memory_id, revision, action, object_key, canonical_stage_token, content_hash, actor_id, auth_kind, created_at)
       VALUES ('sealed-invalid-revision', 'subject-a', ?, ?, 'upsert', ?, ?, 'sealed-hash', 'access:subject-a', 'access', 1)`,
    ).bind(sealed!.memoryId, sealed!.revision, sealed!.objectKey, sealed!.writeToken).run()).rejects.toThrow(/canonical_stage_claim_lost/);
    const after = await snapshot();
    expect(after).toEqual(before);
  });

  it("retains canonical cleanup evidence for a bounded second delete", async () => {
    const key = "okf/test/late-object.md";
    await testEnv.DB.prepare(
      `INSERT INTO canonical_object_staging
       (object_key, memory_id, revision, write_token, status, attempts, next_attempt_at, created_at)
       VALUES (?, 'late-memory', 1, 'late-token', 'pending', 0, 0, 0)`,
    ).bind(key).run();
    await testEnv.BUCKET.put(key, "first");
    const firstAt = CANONICAL_STAGING_TIMEOUT_MS + 1;
    const cleanup = new CanonicalObjectCleanup(testEnv.DB, testEnv.BUCKET, () => firstAt);
    expect((await cleanup.process(10)).deleted).toBe(1);
    expect(await testEnv.BUCKET.head(key)).toBeNull();
    expect(await testEnv.DB.prepare("SELECT delete_confirmations AS confirmations FROM canonical_object_staging WHERE object_key = ?").bind(key).first())
      .toEqual({ confirmations: 2 });
    await testEnv.BUCKET.put(key, "late");
    const secondAt = firstAt + CANONICAL_TOMBSTONE_REDELETE_MS + 1;
    const second = new CanonicalObjectCleanup(testEnv.DB, testEnv.BUCKET, () => secondAt);
    expect((await second.process(10)).deleted).toBe(1);
    expect(await testEnv.BUCKET.head(key)).toBeNull();
    await testEnv.BUCKET.put(key, "later than the second delete");
    const third = new CanonicalObjectCleanup(testEnv.DB, testEnv.BUCKET, () => secondAt + CANONICAL_TOMBSTONE_REDELETE_MS + 1);
    expect((await third.process(10)).deleted).toBe(1);
    expect(await testEnv.BUCKET.head(key)).toBeNull();
    expect(await testEnv.DB.prepare("SELECT delete_confirmations AS confirmations FROM canonical_object_staging WHERE object_key = ?").bind(key).first())
      .toEqual({ confirmations: 4 });
  });

  it("never deletes a canonical object referenced by an authoritative revision", async () => {
    await memoryService().store({ project: "workmory", namespace: "default", key: "canonical/current", source: { content: "current" } });
    const current = await testEnv.DB.prepare(
      "SELECT id, current_revision AS revision, current_object_key AS objectKey FROM memories WHERE key = 'canonical/current'",
    ).first<{ id: string; revision: number; objectKey: string }>();
    await testEnv.DB.prepare(
      `INSERT INTO canonical_object_staging
       (object_key, memory_id, revision, write_token, status, attempts, next_attempt_at, delete_confirmations, created_at)
       VALUES (?, ?, ?, 'cleanup-proof', 'pending', 0, 0, 1, 0)`,
    ).bind(current!.objectKey, current!.id, current!.revision).run();
    const cleanup = new CanonicalObjectCleanup(testEnv.DB, testEnv.BUCKET, () => CANONICAL_STAGING_TIMEOUT_MS + CANONICAL_TOMBSTONE_REDELETE_MS);
    await cleanup.process(10);
    expect(await testEnv.BUCKET.head(current!.objectKey)).not.toBeNull();
    expect(await testEnv.DB.prepare("SELECT 1 FROM canonical_object_staging WHERE object_key = ?").bind(current!.objectKey).first()).toBeNull();
  });

  it("fences every store mutation when the receipt claim changes before R2 returns", async () => {
    const putEntered = deferred();
    const releasePut = deferred();
    const objectStore: ImmutableObjectStore = {
      async putOkf() {
        putEntered.resolve();
        await releasePut.promise;
      },
      async getOkf() { return null; },
    };
    const memory = new D1MemoryService(testEnv.DB, objectStore, accessActor("subject-a"));
    const storing = memory.store({
      project: "workmory",
      namespace: "default",
      key: "fence/store",
      source: { content: "must not commit" },
      tags: ["fenced"],
      operationId: "fenced-store-operation",
    });
    await putEntered.promise;
    await testEnv.DB.prepare(
      "UPDATE operation_receipts SET claim_token = 'replacement-store-claim' WHERE operation_id = 'fenced-store-operation'",
    ).run();
    releasePut.resolve();
    await expect(storing).rejects.toMatchObject({ code: "OPERATION_CONFLICT", message: "operation_id has already been used" });
    const state = await testEnv.DB.prepare(
      `SELECT
         (SELECT count(*) FROM projects) AS projects,
         (SELECT count(*) FROM memories) AS memories,
         (SELECT count(*) FROM memory_revisions) AS revisions,
         (SELECT count(*) FROM memory_tags) AS tags,
         (SELECT count(*) FROM memory_search_docs) AS searchDocs,
         (SELECT count(*) FROM index_outbox) AS outbox`,
    ).first<Record<string, unknown>>();
    expect(state).toEqual({ projects: 0, memories: 0, revisions: 0, tags: 0, searchDocs: 0, outbox: 0 });
    expect(await testEnv.DB.prepare(
      "SELECT status, claim_token AS claimToken FROM operation_receipts WHERE operation_id = 'fenced-store-operation'",
    ).first()).toMatchObject({ status: "processing", claimToken: "replacement-store-claim" });
  });

  it("fences delete state, tags, search docs, and outbox when the receipt claim is lost", async () => {
    const setup = memoryService();
    await setup.store({
      project: "workmory",
      namespace: "default",
      key: "fence/delete",
      source: { content: "still current" },
      tags: ["keep"],
    });
    const snapshot = () => testEnv.DB.prepare(
      `SELECT m.current_revision AS revision, m.deleted,
         (SELECT count(*) FROM memory_revisions) AS revisions,
         (SELECT count(*) FROM memory_tags) AS tags,
         (SELECT count(*) FROM memory_search_docs) AS searchDocs,
         (SELECT count(*) FROM index_outbox) AS outbox
       FROM memories m WHERE m.key = 'fence/delete'`,
    ).first<Record<string, unknown>>();
    const before = await snapshot();
    const base = testEnv.DB;
    const fencedDb = {
      prepare: base.prepare.bind(base),
      batch: async (statements: D1PreparedStatement[]) => {
        await base.prepare(
          "UPDATE operation_receipts SET claim_token = 'replacement-delete-claim' WHERE operation_id = 'fenced-delete-operation'",
        ).run();
        return base.batch(statements);
      },
    } as unknown as D1Database;
    const memory = new D1MemoryService(fencedDb, new R2ObjectStore(testEnv.BUCKET), accessActor("subject-a"));
    await expect(memory.delete({
      project: "workmory",
      namespace: "default",
      key: "fence/delete",
      operationId: "fenced-delete-operation",
    })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(await testEnv.DB.prepare(
      "SELECT status, claim_token AS claimToken FROM operation_receipts WHERE operation_id = 'fenced-delete-operation'",
    ).first()).toMatchObject({ status: "processing", claimToken: "replacement-delete-claim" });
  });

  it("takes over an expired receipt and fences the old claim before URL fetch", async () => {
    let now = 1_000;
    const ownerId = "subject-a";
    const project = "workmory";
    const operationId = "receipt-crash-operation";
    const request = { project, namespace: "default", key: "receipt/crash", source: { source_url: "https://files.example/private?token=secret" } as const, operationId };
    const firstEntered = deferred();
    const crashRelease = deferred();
    const takeoverEntered = deferred();
    const releaseTakeover = deferred();
    let importCalls = 0;
    let urlFetches = 0;
    const attachments: MemoryAttachmentSource = {
      async resolve() { throw new Error("not used"); },
      async importUrl() {
        importCalls += 1;
        if (importCalls === 1) {
          firstEntered.resolve();
          await crashRelease.promise;
          throw new Error("simulated crash");
        }
        urlFetches += 1;
        takeoverEntered.resolve();
        await releaseTakeover.promise;
        return { id: "att_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", filename: "remote.txt", markdown: "remote content", source: "https://files.example/private" };
      },
    };
    const memory = createMemoryService({ DB: testEnv.DB, BUCKET: testEnv.BUCKET }, accessActor(ownerId), { attachments, now: () => now });
    const firstStore = memory.store(request);
    await firstEntered.promise;
    await testEnv.DB.prepare("UPDATE operation_receipts SET claim_token = 'crashed-claim' WHERE operation_id = ?").bind(operationId).run();
    crashRelease.resolve();
    await expect(firstStore).rejects.toThrow("simulated crash");
    expect(await testEnv.DB.prepare(
      "SELECT status, claim_token AS claimToken FROM operation_receipts WHERE operation_id = ?",
    ).bind(operationId).first()).toMatchObject({ status: "processing", claimToken: "crashed-claim" });
    const projectId = await projectOpaqueId(ownerId, project);
    await testEnv.DB.batch([
      testEnv.DB.prepare("INSERT INTO projects (id, owner_id, slug, created_at) VALUES (?, ?, ?, ?)").bind(projectId, ownerId, project, now),
      testEnv.DB.prepare(
        `INSERT INTO attachments
         (id, project_id, status, source_kind, filename, detected_mime, original_size, original_sha256,
          original_r2_key, actor_id, idempotency_key, fingerprint, created_at, updated_at)
         VALUES ('att_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ?, 'ready', 'url', 'remote.txt', 'text/plain', 1, 'hash',
                 'object', 'access:subject-a', 'fixture', 'fixture', ?, ?)`,
      ).bind(projectId, now, now),
    ]);
    now += OPERATION_RECEIPT_LEASE_MS + 1;
    const storing = memory.store(request);
    await takeoverEntered.promise;
    const active = await testEnv.DB.prepare("SELECT claim_token AS claimToken FROM operation_receipts WHERE operation_id = ?")
      .bind(operationId).first<{ claimToken: string }>();
    expect(active?.claimToken).not.toBe("crashed-claim");
    const oldCompletion = await testEnv.DB.prepare(
      "UPDATE operation_receipts SET status = 'complete', revision = 99 WHERE operation_id = ? AND status = 'processing' AND claim_token = ?",
    ).bind(operationId, "crashed-claim").run();
    expect(oldCompletion.meta.changes).toBe(0);
    const oldRelease = await testEnv.DB.prepare(
      "DELETE FROM operation_receipts WHERE operation_id = ? AND status = 'processing' AND claim_token = ?",
    ).bind(operationId, "crashed-claim").run();
    expect(oldRelease.meta.changes).toBe(0);
    releaseTakeover.resolve();
    await expect(storing).resolves.toMatchObject({ revision: 1, content: "remote content" });
    expect(urlFetches).toBe(1);
    expect(await testEnv.DB.prepare(
      "SELECT status, revision, claim_token AS claimToken FROM operation_receipts WHERE operation_id = ?",
    ).bind(operationId).first()).toMatchObject({ status: "complete", revision: 1, claimToken: active?.claimToken });
  });
});
