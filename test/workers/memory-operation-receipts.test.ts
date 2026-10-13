import { beforeEach, describe, expect, it } from "vitest";
import { D1MemoryService, createMemoryService } from "../../server/application/d1-memory-service";
import type { MemoryAttachmentSource } from "../../server/attachments/types";
import { projectOpaqueId } from "../../server/domain/identity";
import { R2ObjectStore } from "../../server/storage/r2-object-store";
import { accessActor, resetTestEnv, testEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";

beforeEach(resetTestEnv);

describe("memory operation receipt idempotency and CAS", () => {
  it("records and replays a completed receipt for an identical-content no-op", async () => {
    const memory = memoryService();
    const base = { project: "workmory", namespace: "default", key: "same/receipt", source: { content: "unchanged" } as const };
    await memory.store(base);
    const request = { ...base, operationId: "same-content-operation" };
    expect((await memory.store(request)).revision).toBe(1);
    expect((await memory.store(request)).revision).toBe(1);
    const receipt = await testEnv.DB.prepare(
      "SELECT status, revision, object_key AS objectKey FROM operation_receipts WHERE operation_id = ?",
    ).bind(request.operationId).first<Record<string, unknown>>();
    expect(receipt).toMatchObject({ status: "complete", revision: 1 });
    expect(receipt?.objectKey).toBeTypeOf("string");
  });

  it("does not report a no-op store as successful after losing its receipt claim", async () => {
    await memoryService().store({ project: "workmory", namespace: "default", key: "same/fenced", source: { content: "unchanged" } });
    const base = testEnv.DB;
    const wrapCompletion = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
      get(target, property) {
        if (property === "bind") return (...values: unknown[]) => wrapCompletion(target.bind(...values));
        if (property === "run") return async () => {
          await base.prepare(
            "UPDATE operation_receipts SET claim_token = 'replacement-noop-claim' WHERE operation_id = 'fenced-noop-operation'",
          ).run();
          return target.run();
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const fencedDb = {
      prepare(query: string) {
        const statement = base.prepare(query);
        return query.includes("UPDATE operation_receipts SET status = 'complete'") ? wrapCompletion(statement) : statement;
      },
      batch: base.batch.bind(base),
    } as unknown as D1Database;
    const memory = new D1MemoryService(fencedDb, new R2ObjectStore(testEnv.BUCKET), accessActor("subject-a"));
    await expect(memory.store({
      project: "workmory",
      namespace: "default",
      key: "same/fenced",
      source: { content: "unchanged" },
      operationId: "fenced-noop-operation",
    })).rejects.toMatchObject({ code: "OPERATION_CONFLICT", message: "operation claim was lost" });
    expect(await testEnv.DB.prepare("SELECT count(*) AS count FROM memory_revisions").first()).toEqual({ count: 1 });
  });

  it("enforces revision conflicts and operation idempotency", async () => {
    const memory = memoryService();
    const request = {
      project: "workmory", namespace: "default", key: "decisions/idempotency", source: { content: "first" } as const,
      expectedRevision: 0, operationId: "operation-idempotent-001",
    };
    const first = await memory.store(request);
    await expect(memory.store({ ...request })).resolves.toMatchObject({ revision: first.revision });
    await expect(memory.store({ ...request, source: { content: "different" } })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    await expect(memory.store({ ...request, operationId: "operation-revision-002", source: { content: "second" } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("allows at most one concurrent writer for a revision", async () => {
    const memory = memoryService();
    const base = { project: "workmory", namespace: "default", key: "concurrency/key", expectedRevision: 0 };
    const results = await Promise.allSettled([
      memory.store({ ...base, source: { content: "writer one" }, operationId: "concurrent-operation-01" }),
      memory.store({ ...base, source: { content: "writer two" }, operationId: "concurrent-operation-02" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("replays a successful source URL operation without fetching again", async () => {
    let importCalls = 0;
    const ownerId = "subject-a";
    const projectId = await projectOpaqueId(ownerId, "workmory");
    const attachments: MemoryAttachmentSource = {
      async resolve() { throw new Error("not used"); },
      async importUrl() {
        importCalls += 1;
        if (importCalls === 1) {
          await testEnv.DB.batch([
            testEnv.DB.prepare("INSERT OR IGNORE INTO projects (id, owner_id, slug, created_at) VALUES (?, ?, 'workmory', 1)").bind(projectId, ownerId),
            testEnv.DB.prepare(
              `INSERT INTO attachments
               (id, project_id, status, source_kind, filename, detected_mime, original_size, original_sha256,
                original_r2_key, actor_id, idempotency_key, fingerprint, created_at, updated_at)
               VALUES ('att_replay', ?, 'ready', 'url', 'remote.txt', 'text/plain', 1, 'hash',
                       'object', 'access:subject-a', 'fixture', 'fixture', 1, 1)`,
            ).bind(projectId),
          ]);
        }
        return { id: "att_replay", filename: "remote.txt", markdown: "remote content", source: "https://files.example/remote.txt" };
      },
    };
    const memory = createMemoryService({ DB: testEnv.DB, BUCKET: testEnv.BUCKET }, accessActor(ownerId), { attachments });
    const request = {
      project: "workmory", namespace: "default", key: "receipt/url-replay",
      source: { source_url: "https://files.example/remote.txt" } as const, operationId: "url-replay-operation",
    };
    await memory.store(request);
    await memory.store(request);
    expect(importCalls).toBe(1);
  });
});
