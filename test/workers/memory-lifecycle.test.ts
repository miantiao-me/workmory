import { beforeEach, describe, expect, it } from "vitest";
import { D1MemoryService, createMemoryService } from "../../server/application/d1-memory-service";
import { MemoryServiceError } from "../../server/application/memory-service";
import { R2ObjectStore, type ImmutableObjectStore } from "../../server/storage/r2-object-store";
import { accessActor, resetTestEnv, testEnv } from "./helpers";
import { memoryService as service } from "./memory-service-helpers";

beforeEach(resetTestEnv);

describe("D1/R2 memory persistence", () => {
  it("rejects oversized raw known projections instead of truncating tags", async () => {
    const memory = service();
    const tags = Array.from({ length: 33 }, (_, index) => `tag-${index}`).map((tag) => `  - ${tag}`).join("\n");
    await expect(memory.store({
      project: "workmory", namespace: "default", key: "validation/tags",
      source: { okf_markdown: `---\ntype: Note\ntags:\n${tags}\n---\nbody` },
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(memory.store({
      project: "workmory", namespace: "default", key: "validation/tag-bytes",
      source: { okf_markdown: `---\ntype: Note\ntags:\n  - ${"界".repeat(22)}\n---\nbody` },
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(memory.store({
      project: "workmory", namespace: "default", key: "validation/kind-bytes",
      source: { okf_markdown: `---\ntype: Note\nkind: ${"界".repeat(43)}\n---\nbody` },
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(memory.store({
      project: "workmory", namespace: "default", key: "validation/status-bytes",
      source: { okf_markdown: `---\ntype: Note\nstatus: ${"界".repeat(22)}\n---\nbody` },
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("builds search prefixes on UTF-8 boundaries", async () => {
    const memory = service();
    await memory.store({
      project: "workmory", namespace: "default", key: "validation/utf8-prefix",
      source: { content: "界".repeat(6_000) },
    });
    const row = await testEnv.DB.prepare("SELECT content, snippet FROM memory_search_docs WHERE key = 'validation/utf8-prefix'")
      .first<{ content: string; snippet: string }>();
    expect(row?.content).not.toContain("�");
    expect(row?.snippet).not.toContain("�");
    expect(new TextEncoder().encode(row!.content).byteLength).toBeLessThanOrEqual(16_384);
    expect(new TextEncoder().encode(row!.snippet).byteLength).toBeLessThanOrEqual(1_000);
  });

  it("isolates Access owners, root, and projects", async () => {
    await service(accessActor("subject-a")).store({
      project: "alpha",
      namespace: "default",
      key: "shared/key",
      source: { content: "owner a alpha" },
    });

    expect(await service(accessActor("subject-b")).retrieve({ project: "alpha", namespace: "default", key: "shared/key" })).toBeNull();
    expect(
      await service({ ownerId: "root", actorId: "root-key", authKind: "root" }).retrieve({
        project: "alpha",
        namespace: "default",
        key: "shared/key",
      }),
    ).toBeNull();
    expect(await service(accessActor("subject-a")).retrieve({ project: "beta", namespace: "default", key: "shared/key" })).toBeNull();
    const root = service({ ownerId: "root", actorId: "root-key", authKind: "root" });
    await root.store({ project: "alpha", namespace: "default", key: "shared/key", source: { content: "root only" } });
    expect((await root.retrieve({ project: "alpha", namespace: "default", key: "shared/key" }))?.content).toBe("root only");
    expect(
      (await service(accessActor("subject-a")).retrieve({ project: "alpha", namespace: "default", key: "shared/key" }))?.content,
    ).toBe("owner a alpha");
  });

  it("stores, retrieves, and preserves unknown OKF fields", async () => {
    const memory = service();
    const stored = await memory.store({
      project: "workmory",
      namespace: "default",
      key: "architecture/storage",
      source: { okf_markdown: "---\ntype: Decision\nfuture:\n  signal: 42\n---\nD1 is authoritative." },
      tags: ["architecture", "storage"],
      operationId: "store-operation-001",
    });
    expect(stored.revision).toBe(1);
    const retrieved = await memory.retrieve({ project: "workmory", namespace: "default", key: "architecture/storage" });
    expect(retrieved?.content).toBe("D1 is authoritative.");
    expect(retrieved?.okfMarkdown).toContain("signal: 42");
    expect(retrieved?.tags).toEqual(["architecture", "storage"]);
    const audit = await testEnv.DB.prepare(
      "SELECT owner_id AS ownerId, actor_id AS actorId, auth_kind AS authKind FROM memory_revisions",
    ).first<Record<string, unknown>>();
    expect(audit).toEqual({ ownerId: "subject-a", actorId: "access:subject-a", authKind: "access" });
  });

  it("preserves canonical Markdown hash and the full R2 object key", async () => {
    const memory = service();
    const stored = await memory.store({
      project: "workmory",
      namespace: "default",
      key: "golden/memory",
      source: { content: "Canonical body" },
      frontmatter: { title: "Golden" },
      kind: "Decision",
      tags: ["golden", "contract"],
      operationId: "golden-operation-001",
    });
    const expectedMarkdown = "---\ntitle: Golden\ntype: Decision\nkind: Decision\ntags:\n  - golden\n  - contract\n---\nCanonical body";
    const expectedHash = "c79f99dbb5edd13b347adfcf974edb406607fcb26613e715eed222d3bf9adcc1";
    expect(stored.okfMarkdown).toBe(expectedMarkdown);
    const revision = await testEnv.DB.prepare(
      "SELECT object_key AS objectKey, content_hash AS contentHash FROM memory_revisions WHERE operation_id = 'golden-operation-001'",
    ).first<Record<string, unknown>>();
    expect(revision?.contentHash).toBe(expectedHash);
    expect(revision?.objectKey).toMatch(/^okf\/[^/]+\/[^/]+\/1\/[a-f0-9]{32}\.md$/);
    expect(await (await testEnv.BUCKET.get(String(revision?.objectKey)))?.text()).toBe(expectedMarkdown);
  });

  it("does not create a new revision for identical content", async () => {
    const memory = service();
    const request = {
      project: "workmory",
      namespace: "default",
      key: "same/content",
      source: { content: "unchanged" } as const,
    };
    expect((await memory.store(request)).revision).toBe(1);
    expect((await memory.store(request)).revision).toBe(1);
    const count = await testEnv.DB.prepare("SELECT count(*) AS count FROM memory_revisions").first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("does not write D1 when R2 fails first", async () => {
    const failingObjects: ImmutableObjectStore = {
      putOkf: async () => {
        throw new Error("R2 unavailable");
      },
      getOkf: async () => null,
    };
    const memory = new D1MemoryService(testEnv.DB, failingObjects, accessActor("subject-a"));
    await expect(
      memory.store({ project: "workmory", namespace: "default", key: "failure/r2", source: { content: "x" } }),
    ).rejects.toThrow("R2 unavailable");
    const count = await testEnv.DB.prepare("SELECT count(*) AS count FROM memories").first<{ count: number }>();
    expect(count?.count).toBe(0);
    expect(await testEnv.DB.prepare("SELECT count(*) AS count FROM memory_link_index").first()).toEqual({ count: 0 });
  });

  it("permits an R2 orphan but no D1 pointer when the atomic batch fails", async () => {
    const failingDb = {
      prepare: testEnv.DB.prepare.bind(testEnv.DB),
      batch: async () => {
        throw new Error("forced D1 failure");
      },
    } as unknown as D1Database;
    const memory = new D1MemoryService(failingDb, new R2ObjectStore(testEnv.BUCKET), accessActor("subject-a"));
    await expect(
      memory.store({ project: "workmory", namespace: "default", key: "failure/d1", source: { content: "orphan" } }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    const objects = await testEnv.BUCKET.list({ prefix: "okf/" });
    expect(objects.objects).toHaveLength(1);
    const count = await testEnv.DB.prepare("SELECT count(*) AS count FROM memories").first<{ count: number }>();
    expect(count?.count).toBe(0);
    expect(await testEnv.DB.prepare("SELECT count(*) AS count FROM memory_link_index").first()).toEqual({ count: 0 });
  });

  it("soft deletes, removes search visibility, retains history, and writes outbox", async () => {
    const memory = service();
    await memory.store({
      project: "workmory",
      namespace: "default",
      key: "delete/me",
      source: { content: "searchable tombstone content" },
      operationId: "delete-setup-operation",
    });
    const before = await testEnv.BUCKET.list({ prefix: "okf/" });
    const deleted = await memory.delete({
      project: "workmory",
      namespace: "default",
      key: "delete/me",
      expectedRevision: 1,
      operationId: "delete-operation-001",
    });
    expect(deleted).toMatchObject({ deleted: true, revision: 2 });
    expect(await memory.retrieve({ project: "workmory", namespace: "default", key: "delete/me" })).toBeNull();
    const search = await memory.search({
      project: "workmory",
      namespace: "default",
      query: "tombstone",
      semanticWeight: 0,
      limit: 20,
    });
    expect(search.items).toHaveLength(0);
    expect((await testEnv.BUCKET.list({ prefix: "okf/" })).objects).toHaveLength(before.objects.length);
    const outbox = await testEnv.DB.prepare("SELECT action, status FROM index_outbox ORDER BY revision").all();
    expect(outbox.results).toEqual([
      expect.objectContaining({ action: "upsert", status: "pending" }),
      expect.objectContaining({ action: "delete", status: "pending" }),
    ]);
  });

  it("stores checkpoints as the normal fixed memory key", async () => {
    const memory = service();
    await memory.updateLast({
      project: "workmory",
      namespace: "default",
      content: "Milestone complete",
      summary: "Storage phase",
      operationId: "checkpoint-operation-01",
    });
    const checkpoint = await memory.getLast({ project: "workmory", namespace: "default" });
    expect(checkpoint).toMatchObject({ key: "system/last_memory", content: "Milestone complete", kind: "Checkpoint" });
  });

  it("rejects unavailable sources and invalid root context", async () => {
    await expect(
      service().store({
        project: "workmory",
        namespace: "default",
        key: "attachment/later",
        source: { attachment_id: "attachment-1" },
      }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(
      () => createMemoryService({ DB: testEnv.DB, BUCKET: testEnv.BUCKET }, { ownerId: "someone", actorId: "root", authKind: "root" }),
    ).toThrow(MemoryServiceError);
  });

});
