import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryService, D1MemoryService } from "../../server/application/d1-memory-service";
import { R2ObjectStore } from "../../server/storage/r2-object-store";
import { accessActor, resetTestEnv, testEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";
import { attachmentService } from "./attachment-fixtures";

beforeEach(resetTestEnv);

describe("memory revision history and restore", () => {
  it("pages revisions newest-first including tombstones and reads old upsert/delete revisions", async () => {
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "history/item", source: { okf_markdown: "---\ntype: Note\nfuture_field:\n  nested: true\n---\nfirst" } });
    await memory.store({ project: "workmory", namespace: "default", key: "history/item", source: { content: "second" } });
    await memory.delete({ project: "workmory", namespace: "default", key: "history/item" });

    const first = await memory.history({ project: "workmory", namespace: "default", key: "history/item", limit: 2 });
    expect(first.items.map((item) => [item.revision, item.action])).toEqual([[3, "delete"], [2, "upsert"]]);
    expect(first.nextCursor).toBeDefined();
    const second = await memory.history({ project: "workmory", namespace: "default", key: "history/item", limit: 2, cursor: first.nextCursor });
    expect(second.items.map((item) => item.revision)).toEqual([1]);
    expect(JSON.stringify(first)).not.toMatch(/objectKey|operationId|owner/i);

    const old = await memory.retrieveRevision({ project: "workmory", namespace: "default", key: "history/item", revision: 1 });
    expect(old.record?.content).toBe("first");
    expect(old.record?.okfMarkdown).toContain("future_field:");
    expect((await memory.retrieveRevision({ project: "workmory", namespace: "default", key: "history/item", revision: 3 })).record).toBeNull();
  });

  it("isolates revision reads by owner, project, and namespace", async () => {
    await memoryService().store({ project: "workmory", namespace: "default", key: "isolated/item", source: { content: "secret" } });
    expect((await memoryService(accessActor("subject-b")).history({ project: "workmory", namespace: "default", key: "isolated/item", limit: 20 })).items).toEqual([]);
    await expect(memoryService(accessActor("subject-b")).retrieveRevision({ project: "workmory", namespace: "default", key: "isolated/item", revision: 1 }))
      .rejects.toMatchObject({ code: "REVISION_NOT_FOUND" });
    await expect(memoryService().retrieveRevision({ project: "other", namespace: "default", key: "isolated/item", revision: 1 }))
      .rejects.toMatchObject({ code: "REVISION_NOT_FOUND" });
    await expect(memoryService().retrieveRevision({ project: "workmory", namespace: "other", key: "isolated/item", revision: 1 }))
      .rejects.toMatchObject({ code: "REVISION_NOT_FOUND" });
  });

  it("restores active, identical, and deleted memories as new revisions and rebuilds projections", async () => {
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "restore/item", source: { content: "first" }, tags: ["old tag"] });
    await memory.store({ project: "workmory", namespace: "default", key: "restore/item", source: { content: "second" } });
    expect((await memory.restore({ project: "workmory", namespace: "default", key: "restore/item", sourceRevision: 1, expectedRevision: 2, operationId: "restore-active-001" })).revision).toBe(3);
    expect((await memory.restore({ project: "workmory", namespace: "default", key: "restore/item", sourceRevision: 1, expectedRevision: 3, operationId: "restore-identical-002" })).revision).toBe(4);
    await memory.delete({ project: "workmory", namespace: "default", key: "restore/item" });
    const restored = await memory.restore({ project: "workmory", namespace: "default", key: "restore/item", sourceRevision: 1, expectedRevision: 5, operationId: "restore-deleted-003" });
    expect(restored).toMatchObject({ revision: 6, content: "first", tags: ["old tag"] });
    const state = await testEnv.DB.prepare(
      `SELECT (SELECT count(*) FROM memory_search_docs) AS searchDocs,
              (SELECT count(*) FROM index_outbox WHERE revision = 6 AND action = 'upsert') AS outbox,
              (SELECT count(*) FROM memory_link_index WHERE revision = 6) AS graph`,
    ).first<Record<string, unknown>>();
    expect(state).toEqual({ searchDocs: 1, outbox: 1, graph: 1 });
  });

  it("rejects delete sources and replays only identical restore operations", async () => {
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "restore/replay", source: { content: "one" } });
    await memory.delete({ project: "workmory", namespace: "default", key: "restore/replay" });
    await expect(memory.restore({ project: "workmory", namespace: "default", key: "restore/replay", sourceRevision: 2, operationId: "restore-delete-source" }))
      .rejects.toMatchObject({ code: "REVISION_NOT_RESTORABLE" });
    const request = { project: "workmory", namespace: "default", key: "restore/replay", sourceRevision: 1, operationId: "restore-replay-001" } as const;
    const first = await memory.restore(request);
    expect((await memory.restore(request)).revision).toBe(first.revision);
    await expect(memory.restore({ ...request, sourceRevision: 2 })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    expect((await memory.history({ project: "workmory", namespace: "default", key: "restore/replay", limit: 20 })).items).toHaveLength(3);
  });

  it("copies historical attachment associations", async () => {
    const attachments = attachmentService().service;
    const uploaded = await attachments.upload({ project: "workmory", filename: "source.txt", body: new TextEncoder().encode("attachment body"), idempotencyKey: "revision-attachment" });
    const memory = createMemoryService({ DB: testEnv.DB, BUCKET: testEnv.BUCKET }, accessActor(), { attachments });
    await memory.store({ project: "workmory", namespace: "default", key: "restore/attachment", source: { attachment_id: uploaded.id } });
    await memory.store({ project: "workmory", namespace: "default", key: "restore/attachment", source: { content: "replacement" } });
    const restored = await memory.restore({ project: "workmory", namespace: "default", key: "restore/attachment", sourceRevision: 1, operationId: "restore-attachment-001" });
    expect(restored.attachmentIds).toEqual([uploaded.id]);
  });

  it("fences restore when its operation lease claim is replaced before the batch", async () => {
    await memoryService().store({ project: "workmory", namespace: "default", key: "restore/fence", source: { content: "source" } });
    const base = testEnv.DB;
    const fencedDb = {
      prepare: base.prepare.bind(base),
      batch: async (statements: D1PreparedStatement[]) => {
        await base.prepare("UPDATE operation_receipts SET claim_token = 'replacement' WHERE operation_id = 'restore-fence-001'").run();
        return base.batch(statements);
      },
    } as unknown as D1Database;
    const memory = new D1MemoryService(fencedDb, new R2ObjectStore(testEnv.BUCKET), accessActor());
    await expect(memory.restore({ project: "workmory", namespace: "default", key: "restore/fence", sourceRevision: 1, operationId: "restore-fence-001" }))
      .rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    expect((await memoryService().history({ project: "workmory", namespace: "default", key: "restore/fence", limit: 20 })).items).toHaveLength(1);
  });
});
