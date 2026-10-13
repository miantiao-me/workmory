import { beforeEach, describe, expect, it } from "vitest";
import { resetTestEnv, testEnv, accessActor } from "./helpers";
import { memoryService } from "./memory-service-helpers";

beforeEach(resetTestEnv);

async function store(key: string, content: string, options: { indexable?: boolean; tags?: string[] } = {}) {
  return memoryService().store({ project: "graph", namespace: "default", key, source: { content }, ...options });
}

describe("memory graph queries", () => {
  it("returns overview pages with isolated nodes and induced, merged edges", async () => {
    await store("a", "[b](b.md) [again](b.md)", { tags: ["source-tag"] });
    await store("b", "isolated target", { tags: ["target-tag"] });
    await store("c", "isolated");
    const first = await memoryService().graph({ mode: "overview", project: "graph", namespace: "default", nodeLimit: 2, edgeLimit: 10 });
    expect(first.nodes.map((node) => node.key)).toEqual(["a", "b"]);
    expect(first.nodes.map((node) => ({ key: node.key, tags: node.tags }))).toEqual([
      { key: "a", tags: ["source-tag"] },
      { key: "b", tags: ["target-tag"] },
    ]);
    expect(first.edges).toEqual([{ sourceKey: "a", targetKey: "b", origin: "link", occurrences: 2, resolved: true }]);
    expect(first).toMatchObject({ truncated: true, truncationReasons: ["node_limit"], coverage: { complete: true } });
    const second = await memoryService().graph({ mode: "overview", project: "graph", namespace: "default", nodeLimit: 2, edgeLimit: 10, cursor: first.nextCursor });
    expect(second.nodes.map((node) => node.key)).toEqual(["c"]);
    expect(second.edges).toEqual([]);
    await expect(memoryService().graph({ mode: "overview", project: "graph", namespace: "default", nodeLimit: 3, edgeLimit: 10, cursor: first.nextCursor }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(memoryService().graph({ mode: "overview", project: "graph", namespace: "default", nodeLimit: 2, edgeLimit: 11, cursor: first.nextCursor }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("supports neighbor directions, broken ghosts, budgets, and bound cursors", async () => {
    await store("root", "[out](target.md) [broken](missing.md)", { tags: ["root-tag"] });
    await store("target", "target", { tags: ["target-tag"] });
    await store("source", "[in](root.md)", { tags: ["source-tag"] });
    const outbound = await memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "outbound", includeBroken: true, edgeLimit: 1 });
    expect(outbound.edges).toHaveLength(1);
    expect(outbound.nextCursor).toBeDefined();
    expect(outbound.nodes).toContainEqual({ key: "missing", resolved: false, tags: [] });
    const outboundNext = await memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "outbound", includeBroken: true, edgeLimit: 1, cursor: outbound.nextCursor });
    expect(outboundNext.edges).toEqual([expect.objectContaining({ targetKey: "target", resolved: true })]);
    expect(outboundNext.nodes.find((node) => node.key === "target")?.tags).toEqual(["target-tag"]);
    await expect(memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "inbound", includeBroken: true, edgeLimit: 1, cursor: outbound.nextCursor }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "outbound", includeBroken: true, edgeLimit: 2, cursor: outbound.nextCursor }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    const inbound = await memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "inbound", includeBroken: false, edgeLimit: 10 });
    expect(inbound.edges).toEqual([expect.objectContaining({ sourceKey: "source", targetKey: "root" })]);
    expect(inbound.nodes.find((node) => node.key === "source")?.tags).toEqual(["source-tag"]);
    const both = await memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "both", includeBroken: false, edgeLimit: 10 });
    expect(both.edges).toHaveLength(2);
  });

  it("requalifies every edge against the source current revision", async () => {
    await store("source", "no current links");
    await store("target", "target");
    await testEnv.DB.prepare(
      `INSERT INTO memory_links (source_memory_id, source_revision, target_memory_id, target_key, origin, raw_target, ordinal)
       SELECT source.id, 0, target.id, 'target', 'link', 'target.md', 99
       FROM memories source, memories target WHERE source.key = 'source' AND target.key = 'target'`,
    ).run();

    const overview = await memoryService().graph({ mode: "overview", project: "graph", namespace: "default", nodeLimit: 50, edgeLimit: 100 });
    expect(overview.edges).toEqual([]);
    const neighbors = await memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "source", direction: "outbound", includeBroken: true, edgeLimit: 100 });
    expect(neighbors.edges).toEqual([]);
  });

  it("uniformly hides deleted, expired, non-indexable, profile, other-scope, and other-owner targets", async () => {
    await store("root", "[deleted](deleted.md) [expired](expired.md) [private](private.md)");
    await store("deleted", "x");
    await store("expired", "x");
    await store("private", "x", { indexable: false });
    await memoryService().delete({ project: "graph", namespace: "default", key: "deleted" });
    await testEnv.DB.prepare("UPDATE memories SET expires_at = 1 WHERE key = 'expired'").run();
    await memoryService().store({ project: "graph", namespace: "other", key: "outside", source: { content: "x" } });
    await memoryService().store({ project: "__workmory_profile__", namespace: "profile", key: "global", source: { content: "x" }, indexable: false });
    const ownerB = memoryService(accessActor("subject-b"));
    await ownerB.store({ project: "graph", namespace: "default", key: "root", source: { content: "other owner" } });

    expect((await ownerB.graph({ mode: "overview", project: "graph", namespace: "default", nodeLimit: 50, edgeLimit: 100 })).nodes.map((node) => node.key)).toEqual(["root"]);
    expect((await memoryService({ ownerId: "root", actorId: "root-key", authKind: "root" }).graph({ mode: "overview", project: "graph", namespace: "default", nodeLimit: 50, edgeLimit: 100 })).nodes).toEqual([]);
    expect((await memoryService().graph({ mode: "overview", project: "graph", namespace: "other", nodeLimit: 50, edgeLimit: 100 })).nodes.map((node) => node.key)).toEqual(["outside"]);
    expect((await memoryService().graph({ mode: "overview", project: "__workmory_profile__", namespace: "profile", nodeLimit: 50, edgeLimit: 100 })).nodes).toEqual([]);

    const result = await memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "outbound", includeBroken: true, edgeLimit: 10 });
    expect(result.edges).toEqual([
      expect.objectContaining({ targetKey: "deleted", resolved: false }),
      expect.objectContaining({ targetKey: "expired", resolved: false }),
      expect.objectContaining({ targetKey: "private", resolved: false }),
    ]);
    await store("deleted", "restored");
    const restored = await memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "outbound", includeBroken: true, edgeLimit: 10 });
    expect(restored.edges.find((edge) => edge.targetKey === "deleted")?.resolved).toBe(true);
  });

  it("reports pending and truncated source coverage", async () => {
    await store("root", "[target](target.md)");
    await store("target", "x");
    await testEnv.DB.prepare("UPDATE memory_link_index SET status = 'pending', truncated = 1 WHERE memory_id = (SELECT id FROM memories WHERE key = 'root')").run();
    const pending = await memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "outbound", includeBroken: false, edgeLimit: 10 });
    expect(pending.coverage).toEqual({ complete: false, pendingSources: 1, truncatedSources: 0 });
    await testEnv.DB.prepare("UPDATE memory_link_index SET status = 'complete' WHERE memory_id = (SELECT id FROM memories WHERE key = 'root')").run();
    const truncated = await memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "outbound", includeBroken: false, edgeLimit: 10 });
    expect(truncated.coverage).toEqual({ complete: false, pendingSources: 0, truncatedSources: 1 });
  });

  it("uses scope-wide coverage for pending inbound sources that have no indexed edge yet", async () => {
    await store("root", "root");
    await store("pending-source", "[root](root.md)");
    await testEnv.DB.batch([
      testEnv.DB.prepare("DELETE FROM memory_links WHERE source_memory_id = (SELECT id FROM memories WHERE key = 'pending-source')"),
      testEnv.DB.prepare("UPDATE memory_link_index SET status = 'pending' WHERE memory_id = (SELECT id FROM memories WHERE key = 'pending-source')"),
    ]);
    const inbound = await memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "inbound", includeBroken: false, edgeLimit: 10 });
    expect(inbound.edges).toEqual([]);
    expect(inbound.coverage).toEqual({ complete: false, pendingSources: 1, truncatedSources: 0 });
  });

  it("requires complete current pointers for roots, sources, targets, and overview nodes", async () => {
    await store("root", "[target](target.md)");
    await store("target", "target");
    await store("source", "[root](root.md)");
    await testEnv.DB.prepare("UPDATE memories SET current_hash = NULL WHERE key = 'target'").run();
    const broken = await memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "outbound", includeBroken: true, edgeLimit: 10 });
    expect(broken.edges).toEqual([expect.objectContaining({ targetKey: "target", resolved: false })]);
    expect((await memoryService().graph({ mode: "overview", project: "graph", namespace: "default", nodeLimit: 50, edgeLimit: 100 })).nodes.map((node) => node.key)).toEqual(["root", "source"]);

    await testEnv.DB.prepare("UPDATE memories SET current_hash = NULL WHERE key = 'source'").run();
    const inbound = await memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "inbound", includeBroken: false, edgeLimit: 10 });
    expect(inbound.edges).toEqual([]);

    await testEnv.DB.prepare("UPDATE memories SET current_object_key = NULL WHERE key = 'root'").run();
    await expect(memoryService().graph({ mode: "neighbors", project: "graph", namespace: "default", rootKey: "root", direction: "outbound", includeBroken: true, edgeLimit: 10 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await memoryService().graph({ mode: "overview", project: "graph", namespace: "default", nodeLimit: 50, edgeLimit: 100 })).nodes).toEqual([]);
  });
});
