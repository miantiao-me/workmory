import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createMemoryService } from "../../server/application/d1-memory-service";
import { AttachmentCleanup } from "../../server/attachments/attachment-cleanup";
import { memoryOpaqueId, projectOpaqueId, type ActorContext } from "../../server/domain/identity";
import type { AttachmentObjectStore } from "../../server/storage/attachment-object-store";

interface MigrationTestEnv extends Env {
  MIGRATION_DB: D1Database;
  UPGRADE_BASE_MIGRATIONS: { name: string; queries: string[] }[];
  UPGRADE_MIGRATION: { name: string; queries: string[] }[];
}

const migrationEnv = env as MigrationTestEnv;
const ownerId = "upgrade-owner";
const actor: ActorContext = { ownerId, actorId: `access:${ownerId}`, authKind: "access" };

describe("D1 migration upgrade chain", () => {
  it("upgrades populated 0000-0008 state through later migrations without losing contracts", async () => {
    const db = migrationEnv.MIGRATION_DB;
    expect(migrationEnv.UPGRADE_BASE_MIGRATIONS.map((migration) => migration.name)).toHaveLength(9);
    expect(migrationEnv.UPGRADE_MIGRATION[0].name).toMatch(/^0009_.*\.sql$/);
    expect(migrationEnv.UPGRADE_MIGRATION[1].name).toMatch(/^0010_.*\.sql$/);
    await applyD1Migrations(db, migrationEnv.UPGRADE_BASE_MIGRATIONS);

    const projectId = await projectOpaqueId(ownerId, "legacy-project");
    const memoryId = await memoryOpaqueId(projectId, "default", "legacy/memory");
    const oldObjectKey = "okf/legacy/canonical-1.md";
    const attachmentId = `att_${"a".repeat(32)}`;
    await db.batch([
      db.prepare("INSERT INTO projects (id, owner_id, slug, created_at) VALUES (?, ?, 'legacy-project', 1)").bind(projectId, ownerId),
      db.prepare(`INSERT INTO memories
        (id, project_id, namespace, key, current_revision, current_object_key, current_hash, kind, status, deleted, indexable, created_at, updated_at)
        VALUES (?, ?, 'default', 'legacy/memory', 0, NULL, NULL, 'Decision', 'stable', 0, 1, 1, 1)`).bind(memoryId, projectId),
      db.prepare(`INSERT INTO operation_receipts
        (owner_id, operation_id, request_hash, action, memory_id, project, namespace, memory_key, status, revision, object_key, content_hash, created_at, completed_at)
        VALUES (?, 'legacy-operation', 'legacy-request-hash', 'upsert', ?, 'legacy-project', 'default', 'legacy/memory', 'complete', 1, ?, 'legacy-content-hash', 1, 1)`)
        .bind(ownerId, memoryId, oldObjectKey),
      db.prepare(`INSERT INTO memory_revisions
        (id, owner_id, memory_id, revision, action, object_key, content_hash, operation_id, operation_hash, actor_id, auth_kind, created_at)
        VALUES ('legacy-revision-1', ?, ?, 1, 'upsert', ?, 'legacy-content-hash', 'legacy-operation', 'legacy-request-hash', ?, 'access', 1)`)
        .bind(ownerId, memoryId, oldObjectKey, actor.actorId),
      db.prepare("UPDATE memories SET current_revision = 1, current_object_key = ?, current_hash = 'legacy-content-hash' WHERE id = ?").bind(oldObjectKey, memoryId),
      db.prepare(`INSERT INTO memory_search_docs
        (memory_id, project_id, namespace, revision, key, tags, kind, status, content, snippet, updated_at)
        VALUES (?, ?, 'default', 1, 'legacy/memory', 'legacy upgrade', 'Decision', 'stable', 'legacy searchable phrase', 'legacy searchable phrase', 1)`)
        .bind(memoryId, projectId),
      db.prepare(`INSERT INTO index_outbox
        (id, action, memory_id, revision, status, attempts, next_attempt_at, operation_id, content_hash, created_at, mutation_id)
        VALUES ('legacy-outbox', 'upsert', ?, 1, 'done', 0, 0, 'legacy-operation', 'legacy-content-hash', 1, 'legacy-mutation')`).bind(memoryId),
      db.prepare(`INSERT INTO semantic_vectors
        (memory_id, revision, vector_id, content_hash, model, dimensions, index_version, mutation_id, indexed_at)
        VALUES (?, 1, 'legacy-vector', 'legacy-content-hash', 'legacy-model', 3, 'legacy-v1', 'legacy-mutation', 1)`).bind(memoryId),
      db.prepare(`INSERT INTO attachments
        (id, project_id, status, source_kind, filename, detected_mime, original_size, original_sha256, original_r2_key,
         actor_id, idempotency_key, fingerprint, created_at, updated_at)
        VALUES (?, ?, 'ready', 'upload', 'legacy.txt', 'text/plain', 6, 'legacy-sha', 'attachments/legacy', ?, 'legacy-upload', 'legacy-fingerprint', 1, 1)`)
        .bind(attachmentId, projectId, actor.actorId),
    ]);

    expect(await db.prepare("SELECT memory_id FROM memory_search_fts WHERE memory_search_fts MATCH ?")
      .bind('"legacy searchable"').first()).toEqual({ memory_id: memoryId });

    await applyD1Migrations(db, migrationEnv.UPGRADE_MIGRATION);

    expect(await db.prepare(`SELECT p.owner_id AS ownerId, p.slug, m.current_revision AS revision,
      m.current_object_key AS objectKey, m.current_hash AS contentHash
      FROM memories m JOIN projects p ON p.id = m.project_id WHERE m.id = ?`).bind(memoryId).first()).toEqual({
      ownerId,
      slug: "legacy-project",
      revision: 1,
      objectKey: oldObjectKey,
      contentHash: "legacy-content-hash",
    });
    expect(await db.prepare("SELECT status, revision, object_key AS objectKey FROM operation_receipts WHERE owner_id = ? AND operation_id = 'legacy-operation'")
      .bind(ownerId).first()).toEqual({ status: "complete", revision: 1, objectKey: oldObjectKey });
    expect(await db.prepare("SELECT vector_id AS vectorId FROM semantic_vectors WHERE memory_id = ?").bind(memoryId).first())
      .toEqual({ vectorId: "legacy-vector" });
    expect(await db.prepare("SELECT status FROM index_outbox WHERE id = 'legacy-outbox'").first()).toEqual({ status: "done" });
    await db.prepare(
      `INSERT INTO vector_cleanup (id, vector_id, status, attempts, next_attempt_at, created_at)
       VALUES ('legacy-cleanup-default', 'legacy-cleanup-vector', 'pending', 0, 0, 0)`,
    ).run();
    expect(await db.prepare("SELECT retain_tombstone AS retain FROM vector_cleanup WHERE id = 'legacy-cleanup-default'").first())
      .toEqual({ retain: 0 });
    const vectorCleanupColumns = await db.prepare("PRAGMA table_info('vector_cleanup')").all<{ name: string }>();
    expect(vectorCleanupColumns.results.map((column) => column.name)).toContain("retain_tombstone");
    expect(vectorCleanupColumns.results.map((column) => column.name)).not.toContain("delete_confirmations");
    const canonicalColumns = await db.prepare("PRAGMA table_info('canonical_object_staging')").all<{ name: string }>();
    expect(canonicalColumns.results.map((column) => column.name)).toContain("delete_confirmations");
    expect((await db.prepare("PRAGMA foreign_key_list('vector_staging')").all()).results).toEqual([]);
    expect(await db.prepare("SELECT lifecycle, delete_attempts AS deleteAttempts FROM attachments WHERE id = ?").bind(attachmentId).first())
      .toEqual({ lifecycle: "user", deleteAttempts: 0 });
    const attachmentIndexes = await db.prepare("PRAGMA index_list('memory_revision_attachments')").all<{ name: string }>();
    expect(attachmentIndexes.results.map((item) => item.name)).toContain("memory_revision_attachments_attachment_idx");
    expect(await db.prepare("SELECT memory_id FROM memory_search_fts WHERE memory_search_fts MATCH ?")
      .bind('"legacy searchable"').first()).toEqual({ memory_id: memoryId });

    const deleteObjects = vi.fn(async () => undefined);
    const objectStore = {
      put: async () => undefined,
      get: async () => null,
      delete: deleteObjects,
    } satisfies AttachmentObjectStore;
    expect(await new AttachmentCleanup(db, objectStore, () => 100_000_000).cleanupStale()).toEqual({ markedFailed: 0, deleted: 0 });
    expect(deleteObjects).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT status, lifecycle FROM attachments WHERE id = ?").bind(attachmentId).first())
      .toEqual({ status: "ready", lifecycle: "user" });

    const memory = createMemoryService({ DB: db, BUCKET: migrationEnv.BUCKET }, actor, { now: () => 100_000_001 });
    const updated = await memory.store({
      project: "legacy-project",
      namespace: "default",
      key: "legacy/memory",
      source: { content: "post-upgrade searchable content" },
      expectedRevision: 1,
      operationId: "post-upgrade-operation",
    });
    expect(updated).toMatchObject({ revision: 2, content: "post-upgrade searchable content" });
    const current = await db.prepare("SELECT current_revision AS revision, current_object_key AS objectKey FROM memories WHERE id = ?")
      .bind(memoryId).first<{ revision: number; objectKey: string }>();
    expect(current?.revision).toBe(2);
    expect(current?.objectKey).not.toBe(oldObjectKey);
    expect(await migrationEnv.BUCKET.head(current!.objectKey)).not.toBeNull();
    expect(await db.prepare("SELECT count(*) AS count FROM canonical_object_staging").first()).toEqual({ count: 0 });
    expect(await db.prepare("SELECT canonical_stage_token AS token FROM memory_revisions WHERE revision = 2").first())
      .toEqual({ token: expect.any(String) });
    expect(await db.prepare("SELECT status, revision FROM operation_receipts WHERE owner_id = ? AND operation_id = 'post-upgrade-operation'")
      .bind(ownerId).first()).toEqual({ status: "complete", revision: 2 });
    expect(await db.prepare("SELECT memory_id FROM memory_search_fts WHERE memory_search_fts MATCH ?")
      .bind('"post-upgrade searchable"').first()).toEqual({ memory_id: memoryId });
    expect(await db.prepare("SELECT memory_id FROM memory_search_fts WHERE memory_search_fts MATCH ?")
      .bind('"legacy searchable"').first()).toBeNull();

    await expect(memory.delete({
      project: "legacy-project",
      namespace: "default",
      key: "legacy/memory",
      expectedRevision: 2,
      operationId: "post-upgrade-delete",
    })).resolves.toMatchObject({ revision: 3, deleted: true });
    expect(await db.prepare("SELECT action, canonical_stage_token AS token FROM memory_revisions WHERE revision = 3").first())
      .toEqual({ action: "delete", token: null });

    await expect(db.prepare(`INSERT INTO memory_revisions
      (id, owner_id, memory_id, revision, action, object_key, content_hash, operation_id, operation_hash, actor_id, auth_kind, created_at)
      VALUES ('invalid-revision-4', ?, ?, 4, 'upsert', 'invalid-object', 'invalid-hash', 'missing-operation', 'missing-hash', ?, 'access', 4)`)
      .bind(ownerId, memoryId, actor.actorId).run()).rejects.toThrow(/operation_claim_lost/);

    await expect(db.prepare(`INSERT INTO memory_revisions
      (id, owner_id, memory_id, revision, action, object_key, content_hash, actor_id, auth_kind, created_at)
      VALUES ('missing-stage-revision-4', ?, ?, 4, 'upsert', 'missing-stage-object', 'invalid-hash', ?, 'access', 4)`)
      .bind(ownerId, memoryId, actor.actorId).run()).rejects.toThrow(/canonical_stage_claim_lost/);

    await expect(db.prepare(`INSERT INTO memory_revisions
      (id, owner_id, memory_id, revision, action, object_key, canonical_stage_token, content_hash, actor_id, auth_kind, created_at)
      VALUES ('invalid-stage-revision-4', ?, ?, 4, 'upsert', 'missing-stage-object', 'missing-stage-token', 'invalid-hash', ?, 'access', 4)`)
      .bind(ownerId, memoryId, actor.actorId).run()).rejects.toThrow(/canonical_stage_claim_lost/);
  });
});
