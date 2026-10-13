import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryService } from "../../server/application/d1-memory-service";
import { PROFILE_GLOBAL_KEY, PROFILE_NAMESPACE, PROFILE_PROJECT } from "../../server/domain/profile";
import { enqueueSemanticReindex, processPendingOutbox } from "../../server/search/outbox-processor";
import { accessActor, resetTestEnv, testEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";
import {
  semanticRuntime,
} from "./semantic-search-helpers";

beforeEach(resetTestEnv);

describe("internal non-indexable memories", () => {
  it("keeps profile revisions retrievable but outside every derived index", async () => {
    const { runtime, embeddings, vectors } = semanticRuntime();
    const deferredWork: Promise<unknown>[] = [];
    const memory = createMemoryService(
      { DB: testEnv.DB, BUCKET: testEnv.BUCKET },
      accessActor("subject-a"),
      { semantic: runtime, defer: (promise) => deferredWork.push(promise) },
    );
    const request = {
      project: PROFILE_PROJECT,
      namespace: PROFILE_NAMESPACE,
      key: PROFILE_GLOBAL_KEY,
      source: { content: "private profile" } as const,
      tags: ["must-not-index"],
      operationId: "profile-store-operation",
      indexable: false,
    };
    expect((await memory.store(request)).content).toBe("private profile");
    expect((await memory.store({ ...request, source: { content: "updated profile" }, operationId: "profile-update-operation" })).revision).toBe(2);
    expect(deferredWork).toHaveLength(0);
    expect((await memory.retrieve({ project: PROFILE_PROJECT, namespace: PROFILE_NAMESPACE, key: PROFILE_GLOBAL_KEY }))?.content).toBe("updated profile");
    expect(await memoryService().search({
      project: PROFILE_PROJECT,
      namespace: PROFILE_NAMESPACE,
      query: "profile",
      semanticWeight: 0,
      limit: 20,
    })).toMatchObject({ items: [] });
    const derived = await testEnv.DB.prepare(
      `SELECT
         (SELECT indexable FROM memories WHERE key = ?) AS indexable,
         (SELECT count(*) FROM memory_tags) AS tags,
         (SELECT count(*) FROM memory_search_docs) AS searchDocs,
         (SELECT count(*) FROM index_outbox) AS outbox,
         (SELECT count(*) FROM semantic_vectors) AS vectors`,
    ).bind(PROFILE_GLOBAL_KEY).first<Record<string, unknown>>();
    expect(derived).toEqual({ indexable: 0, tags: 0, searchDocs: 0, outbox: 0, vectors: 0 });
    expect(await enqueueSemanticReindex(testEnv.DB)).toEqual({ enqueued: 0 });
    await testEnv.DB.batch([
      testEnv.DB.prepare("INSERT INTO memory_tags (memory_id, tag) SELECT id, 'dirty' FROM memories WHERE key = ?").bind(PROFILE_GLOBAL_KEY),
      testEnv.DB.prepare(
        `INSERT INTO memory_search_docs
         (memory_id, project_id, namespace, revision, key, tags, kind, status, content, snippet, updated_at)
         SELECT id, project_id, namespace, current_revision, key, 'dirty', NULL, status, 'dirty profile', 'dirty profile', 0
         FROM memories WHERE key = ?`,
      ).bind(PROFILE_GLOBAL_KEY),
      testEnv.DB.prepare(
        `INSERT INTO index_outbox
         (id, action, memory_id, revision, status, attempts, next_attempt_at, content_hash, created_at)
         SELECT 'dirty-profile-outbox', 'upsert', id, current_revision, 'pending', 0, 0, current_hash, 0
         FROM memories WHERE key = ?`,
      ).bind(PROFILE_GLOBAL_KEY),
    ]);
    expect(await memoryService().search({
      project: PROFILE_PROJECT,
      namespace: PROFILE_NAMESPACE,
      query: "dirty profile",
      semanticWeight: 0,
      limit: 20,
    })).toMatchObject({ items: [] });
    expect(await processPendingOutbox(testEnv.DB, runtime, 10)).toEqual({ claimed: 1, succeeded: 1, failed: 0 });
    expect(embeddings.documentCalls).toEqual([]);
    expect(vectors.upsertCalls).toBe(0);

    await testEnv.DB.prepare(
      `INSERT INTO semantic_vectors
       (memory_id, revision, vector_id, content_hash, model, dimensions, index_version, mutation_id, indexed_at)
       SELECT id, current_revision, 'dirty-profile-vector', current_hash, 'fake-multilingual', 3, 'test-v1', 'dirty', 0
       FROM memories WHERE key = ?`,
    ).bind(PROFILE_GLOBAL_KEY).run();
    await memory.delete({
      project: PROFILE_PROJECT,
      namespace: PROFILE_NAMESPACE,
      key: PROFILE_GLOBAL_KEY,
      operationId: "profile-delete-operation",
    });
    expect(deferredWork).toHaveLength(0);
    expect(vectors.deleteCalls).toBe(0);
    expect((await testEnv.DB.prepare("SELECT count(*) AS count FROM semantic_vectors").first<{ count: number }>())?.count).toBe(0);
    expect((await testEnv.DB.prepare("SELECT count(*) AS count FROM index_outbox").first<{ count: number }>())?.count).toBe(0);
  });

  it("does not allow indexability changes and preserves owner isolation", async () => {
    const owner = memoryService(accessActor("subject-a"));
    await owner.store({
      project: PROFILE_PROJECT,
      namespace: PROFILE_NAMESPACE,
      key: PROFILE_GLOBAL_KEY,
      source: { content: "owner profile" },
      indexable: false,
    });
    await expect(owner.store({
      project: PROFILE_PROJECT,
      namespace: PROFILE_NAMESPACE,
      key: PROFILE_GLOBAL_KEY,
      source: { content: "switch" },
    })).rejects.toMatchObject({ code: "INVALID_INPUT", message: "Memory indexability cannot be changed" });
    expect(await memoryService(accessActor("subject-b")).retrieve({ project: PROFILE_PROJECT, namespace: PROFILE_NAMESPACE, key: PROFILE_GLOBAL_KEY })).toBeNull();
    expect(await memoryService({ ownerId: "root", actorId: "root-key", authKind: "root" }).retrieve({
      project: PROFILE_PROJECT,
      namespace: PROFILE_NAMESPACE,
      key: PROFILE_GLOBAL_KEY,
    })).toBeNull();
  });

  it("defaults migrated and ordinary memories to indexable", async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare("INSERT INTO projects (id, owner_id, slug, created_at) VALUES ('default-project', 'subject-a', 'default-project', 0)"),
      testEnv.DB.prepare(
        "INSERT INTO memories (id, project_id, namespace, key, current_revision, status, deleted, created_at, updated_at) VALUES ('default-memory', 'default-project', 'default', 'default/key', 0, 'stable', 0, 0, 0)",
      ),
    ]);
    expect(await testEnv.DB.prepare("SELECT indexable FROM memories WHERE id = 'default-memory'").first()).toEqual({ indexable: 1 });
    await memoryService().store({ project: "workmory", namespace: "default", key: "ordinary/key", source: { content: "ordinary" } });
    expect(await testEnv.DB.prepare("SELECT indexable FROM memories WHERE key = 'ordinary/key'").first()).toEqual({ indexable: 1 });
  });
});
