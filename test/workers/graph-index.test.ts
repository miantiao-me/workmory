import { beforeEach, describe, expect, it } from "vitest";
import { memoryOpaqueId, projectOpaqueId } from "../../server/domain/identity";
import { MEMORY_LINK_EXTRACTOR_VERSION } from "../../server/domain/memory-links";
import { resetTestEnv, testEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";

beforeEach(resetTestEnv);

async function graphRows() {
  return (await testEnv.DB.prepare(
    "SELECT source_revision AS sourceRevision, target_memory_id AS targetMemoryId, target_key AS targetKey, origin, raw_target AS rawTarget, ordinal FROM memory_links ORDER BY ordinal",
  ).all()).results;
}

describe("derived memory graph index", () => {
  it("indexes duplicate links and provenance sources with deterministic target identities", async () => {
    await memoryService().store({
      project: "workmory",
      namespace: "default",
      key: "guides/start",
      source: { okf_markdown: "---\ntype: Note\nsources:\n  - resource: /source.md\n---\n[one](./target.md) and [two](./target.md)" },
    });
    const projectId = await projectOpaqueId("subject-a", "workmory");
    expect(await graphRows()).toEqual([
      { sourceRevision: 1, targetMemoryId: await memoryOpaqueId(projectId, "default", "guides/target"), targetKey: "guides/target", origin: "link", rawTarget: "./target.md", ordinal: 0 },
      { sourceRevision: 1, targetMemoryId: await memoryOpaqueId(projectId, "default", "guides/target"), targetKey: "guides/target", origin: "link", rawTarget: "./target.md", ordinal: 1 },
      { sourceRevision: 1, targetMemoryId: await memoryOpaqueId(projectId, "default", "source"), targetKey: "source", origin: "source", rawTarget: "/source.md", ordinal: 2 },
    ]);
    expect(await testEnv.DB.prepare("SELECT revision, extractor_version AS extractorVersion, status, truncated, attempts FROM memory_link_index").first()).toEqual({
      revision: 1, extractorVersion: MEMORY_LINK_EXTRACTOR_VERSION, status: "complete", truncated: 0, attempts: 0,
    });
  });

  it("replaces outgoing links on update and clears them on delete without removing incoming links", async () => {
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "source", source: { content: "[broken](target.md)" } });
    await memory.store({ project: "workmory", namespace: "default", key: "target", source: { content: "target" } });
    await memory.delete({ project: "workmory", namespace: "default", key: "target" });
    expect(await graphRows()).toHaveLength(1);
    await memory.store({ project: "workmory", namespace: "default", key: "target", source: { content: "restored" } });
    expect(await graphRows()).toHaveLength(1);

    await memory.store({ project: "workmory", namespace: "default", key: "source", source: { content: "[new](other.md)" }, expectedRevision: 1 });
    expect(await graphRows()).toEqual([expect.objectContaining({ sourceRevision: 2, targetKey: "other" })]);
    await memory.delete({ project: "workmory", namespace: "default", key: "source", expectedRevision: 2 });
    expect(await graphRows()).toEqual([]);
    expect(await testEnv.DB.prepare("SELECT * FROM memory_link_index WHERE memory_id = (SELECT id FROM memories WHERE key = 'source')").first()).toBeNull();
  });

  it("does not rewrite graph state for no-op or failed revision-boundary updates", async () => {
    const memory = memoryService();
    const request = { project: "workmory", namespace: "default", key: "source", source: { content: "[target](target.md)" } } as const;
    await memory.store(request);
    await memory.store(request);
    await expect(memory.store({ ...request, source: { content: "[other](other.md)" }, expectedRevision: 0 })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await graphRows()).toEqual([expect.objectContaining({ sourceRevision: 1, targetKey: "target" })]);
  });

  it("does not create graph state for non-indexable profile storage", async () => {
    await memoryService().store({
      project: "__workmory_profile__",
      namespace: "profile",
      key: "global",
      source: { content: "[ignored](target.md)" },
      indexable: false,
    });
    expect(await graphRows()).toEqual([]);
    expect(await testEnv.DB.prepare("SELECT count(*) AS count FROM memory_link_index").first()).toEqual({ count: 0 });
  });
});
