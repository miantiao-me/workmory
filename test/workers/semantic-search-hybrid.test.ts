import { beforeEach, describe, expect, it } from "vitest";
import { processPendingOutbox } from "../../server/search/outbox-processor";
import { accessActor, resetTestEnv, testEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";
import { semanticRuntime, vectorIds } from "./semantic-search-helpers";

beforeEach(resetTestEnv);

describe("semantic, hybrid, and qualification search", () => {
  it("keeps fixed prefixes for exact key, exact tag, and semantic-only results", async () => {
    const { runtime, vectors } = semanticRuntime();
    const memory = memoryService(accessActor("subject-a"), { semantic: runtime });
    const longBody = `prefix retained ${"body ".repeat(250)}end`;
    await memory.store({ project: "workmory", namespace: "default", key: "exact/prefix", source: { content: longBody } });
    await memory.store({ project: "workmory", namespace: "default", key: "tag/prefix", source: { content: longBody }, tags: ["exact-tag"] });
    await memory.store({ project: "workmory", namespace: "default", key: "semantic/prefix", source: { content: longBody } });
    await processPendingOutbox(testEnv.DB, runtime, 10);

    const semanticVector = await testEnv.DB.prepare(
      "SELECT sv.vector_id AS vectorId FROM semantic_vectors sv JOIN memories m ON m.id = sv.memory_id WHERE m.key = ?",
    ).bind("semantic/prefix").first<{ vectorId: string }>();
    vectors.queryMatches = [{ id: semanticVector!.vectorId }];

    const exact = await memory.search({ project: "workmory", namespace: "default", query: "exact/prefix", semanticWeight: 0, limit: 20 });
    const tag = await memory.search({ project: "workmory", namespace: "default", query: "exact-tag", semanticWeight: 0, limit: 20 });
    const semantic = await memory.search({ project: "workmory", namespace: "default", query: "no lexical occurrence", semanticWeight: 1, limit: 20 });

    expect(exact.items[0].record.content).toBe(longBody.slice(0, 1_000));
    expect(tag.items[0].record.content).toBe(longBody.slice(0, 1_000));
    expect(semantic.items[0].record.content).toBe(longBody.slice(0, 1_000));
  });

  it("keeps the lexical snippet and unchanged RRF score for a hybrid duplicate", async () => {
    const { runtime, vectors } = semanticRuntime();
    const memory = memoryService(accessActor("subject-a"), { semantic: runtime });
    const prefix = "semantic fixed prefix ".repeat(70);
    const query = "hybrid distant phrase";
    await memory.store({
      project: "workmory",
      namespace: "default",
      key: "search/hybrid-duplicate",
      source: { content: `${prefix}${query} trailing text` },
    });
    await processPendingOutbox(testEnv.DB, runtime, 10);
    vectors.queryMatches = (await vectorIds()).map((id) => ({ id }));

    const result = await memory.search({ project: "workmory", namespace: "default", query, semanticWeight: 0.5, limit: 20 });

    expect(result.items[0].record.content).toContain(query);
    expect(result.items[0].score).toBeCloseTo(1 / 61);
    expect(result.items[0].scoreBreakdown).toEqual({
      lexical: 0.5 / 61,
      semantic: 0.5 / 61,
      lexicalRank: 1,
      semanticRank: 1,
    });
  });

  it("returns lexical results with explicit semantic degradation", async () => {
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "search/degraded", source: { content: "semantic backend pending" } });
    const result = await memory.search({ project: "workmory", namespace: "default", query: "backend", semanticWeight: 0.8, limit: 20 });
    expect(result).toMatchObject({ degraded: true, effectiveSemanticWeight: 0 });
    expect(result.items).toHaveLength(1);
  });

  it("never invokes semantic dependencies at weight zero", async () => {
    const { runtime, embeddings, vectors } = semanticRuntime();
    const memory = memoryService(accessActor("subject-a"), { semantic: runtime });
    await memory.store({ project: "workmory", namespace: "default", key: "search/zero", source: { content: "lexical only" } });
    const result = await memory.search({ project: "workmory", namespace: "default", query: "lexical", semanticWeight: 0, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(embeddings.queryCalls).toEqual([]);
    expect(vectors.queryCalls).toBe(0);
  });

  it("uses semantic candidates for English and Chinese queries without raw scores", async () => {
    const { runtime, embeddings, vectors } = semanticRuntime();
    const memory = memoryService(accessActor("subject-a"), { semantic: runtime });
    await memory.store({ project: "workmory", namespace: "default", key: "semantic/english", source: { content: "architecture decision" } });
    await memory.store({ project: "workmory", namespace: "default", key: "semantic/chinese", source: { content: "用户界面偏好" } });
    await processPendingOutbox(testEnv.DB, runtime, 10);
    vectors.queryMatches = (await vectorIds()).reverse().map((id) => ({ id }));
    const english = await memory.search({ project: "workmory", namespace: "default", query: "unmatched English concept", semanticWeight: 1, limit: 20 });
    const chinese = await memory.search({ project: "workmory", namespace: "default", query: "中文语义查询", semanticWeight: 1, limit: 20 });
    expect(english.items).toHaveLength(2);
    expect(chinese.items).toHaveLength(2);
    expect(english.effectiveSemanticWeight).toBe(1);
    expect(embeddings.queryCalls).toEqual(["unmatched English concept", "中文语义查询"]);
  });

  it("degrades to lexical search on embedding, vector, or dimension failures", async () => {
    const { runtime, embeddings, vectors } = semanticRuntime();
    const memory = memoryService(accessActor("subject-a"), { semantic: runtime });
    await memory.store({ project: "workmory", namespace: "default", key: "search/fallback", source: { content: "fallback lexical result" } });
    for (const failure of ["embedding", "vector", "dimensions"] as const) {
      embeddings.fail = failure === "embedding";
      embeddings.dimensions = failure === "dimensions" ? 2 : 3;
      vectors.failQuery = failure === "vector";
      const result = await memory.search({ project: "workmory", namespace: "default", query: "fallback", semanticWeight: 0.7, limit: 20 });
      expect(result).toMatchObject({ degraded: true, effectiveSemanticWeight: 0 });
      expect(result.items).toHaveLength(1);
    }
  });

  it("filters stale revisions, deleted rows, other owners/projects, and applies filters and limits", async () => {
    const { runtime, vectors } = semanticRuntime();
    const ownerA = memoryService(accessActor("subject-a"));
    const ownerB = memoryService(accessActor("subject-b"));
    await ownerA.store({ project: "workmory", namespace: "default", key: "valid/one", source: { content: "valid semantic" }, kind: "Decision", tags: ["keep"] });
    await ownerA.store({ project: "other", namespace: "default", key: "other/project", source: { content: "other project" }, kind: "Decision", tags: ["keep"] });
    await ownerB.store({ project: "workmory", namespace: "default", key: "other/owner", source: { content: "other owner" }, kind: "Decision", tags: ["keep"] });
    await ownerA.store({ project: "workmory", namespace: "default", key: "stale/revision", source: { content: "old revision" }, kind: "Decision", tags: ["keep"] });
    await ownerA.store({ project: "workmory", namespace: "default", key: "deleted/item", source: { content: "deleted semantic" }, kind: "Decision", tags: ["keep"] });
    await processPendingOutbox(testEnv.DB, runtime, 10);
    await ownerA.store({ project: "workmory", namespace: "default", key: "stale/revision", source: { content: "new revision not indexed" }, kind: "Decision", tags: ["keep"] });
    await ownerA.delete({ project: "workmory", namespace: "default", key: "deleted/item" });
    vectors.queryMatches = (await vectorIds()).map((id) => ({ id }));
    const memory = memoryService(accessActor("subject-a"), { semantic: runtime });
    const result = await memory.search({ project: "workmory", namespace: "default", query: "no lexical match", semanticWeight: 1, limit: 1, filters: { kind: "Decision", tags: ["keep"] } });
    expect(result.items.map((item) => item.record.key)).toEqual(["valid/one"]);
    expect(result.items[0].scoreBreakdown?.semanticRank).toBe(1);
  });

  it("qualifies semantic candidates by namespace, expiry, and current content hash", async () => {
    const { runtime, vectors } = semanticRuntime();
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "valid/qualification", source: { content: "valid candidate" } });
    await memory.store({ project: "workmory", namespace: "other", key: "wrong/namespace", source: { content: "wrong namespace" } });
    await memory.store({ project: "workmory", namespace: "default", key: "expired/candidate", source: { content: "expired candidate" } });
    await memory.store({ project: "workmory", namespace: "default", key: "wrong/current-hash", source: { content: "wrong hash" } });
    await processPendingOutbox(testEnv.DB, runtime, 10);
    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE memories SET expires_at = 1 WHERE key = ?").bind("expired/candidate"),
      testEnv.DB.prepare("UPDATE memories SET current_hash = ? WHERE key = ?").bind("mismatched-current-hash", "wrong/current-hash"),
    ]);
    const ids = await testEnv.DB.prepare(
      "SELECT sv.vector_id AS vectorId FROM semantic_vectors sv JOIN memories m ON m.id = sv.memory_id ORDER BY m.key",
    ).all<{ vectorId: string }>();
    vectors.queryMatches = ids.results.map(({ vectorId }) => ({ id: vectorId }));

    const search = memoryService(accessActor("subject-a"), { semantic: runtime });
    const result = await search.search({ project: "workmory", namespace: "default", query: "no lexical match", semanticWeight: 1, limit: 20 });

    expect(result.items.map((item) => item.record.key)).toEqual(["valid/qualification"]);
  });

  it("uses one injected time boundary for lexical and semantic candidates in a hybrid search", async () => {
    const { runtime, vectors } = semanticRuntime();
    const memory = memoryService();
    const query = "shared time boundary";
    await memory.store({ project: "workmory", namespace: "default", key: "lexical/boundary", source: { content: query } });
    await memory.store({ project: "workmory", namespace: "default", key: "semantic/boundary", source: { content: "semantic only" } });
    await processPendingOutbox(testEnv.DB, runtime, 10);
    await testEnv.DB.prepare("UPDATE memories SET expires_at = 200 WHERE key IN (?, ?)")
      .bind("lexical/boundary", "semantic/boundary").run();
    const semanticVector = await testEnv.DB.prepare(
      "SELECT sv.vector_id AS vectorId FROM semantic_vectors sv JOIN memories m ON m.id = sv.memory_id WHERE m.key = ?",
    ).bind("semantic/boundary").first<{ vectorId: string }>();
    vectors.queryMatches = [{ id: semanticVector!.vectorId }];
    let nowCalls = 0;
    const search = memoryService(accessActor("subject-a"), {
      semantic: runtime,
      now: () => (++nowCalls === 1 ? 100 : 300),
    });

    const result = await search.search({ project: "workmory", namespace: "default", query, semanticWeight: 0.5, limit: 20 });

    expect(nowCalls).toBe(1);
    expect(result.items.map((item) => item.record.key)).toEqual(["lexical/boundary", "semantic/boundary"]);
  });

  it("keeps exact keys ahead of semantic rank at weight one", async () => {
    const { runtime, vectors } = semanticRuntime();
    const memory = memoryService(accessActor("subject-a"), { semantic: runtime });
    await memory.store({ project: "workmory", namespace: "default", key: "exact/key", source: { content: "exact" } });
    await memory.store({ project: "workmory", namespace: "default", key: "semantic/first", source: { content: "semantic" } });
    await processPendingOutbox(testEnv.DB, runtime, 10);
    const ids = await testEnv.DB.prepare("SELECT sv.vector_id AS vectorId, m.key FROM semantic_vectors sv JOIN memories m ON m.id = sv.memory_id ORDER BY m.key").all<{ vectorId: string; key: string }>();
    vectors.queryMatches = ids.results.sort((a, b) => (a.key === "semantic/first" ? -1 : b.key === "semantic/first" ? 1 : 0)).map(({ vectorId }) => ({ id: vectorId }));
    const result = await memory.search({ project: "workmory", namespace: "default", query: "exact/key", semanticWeight: 1, limit: 20 });
    expect(result.items[0].record.key).toBe("exact/key");
  });
});
