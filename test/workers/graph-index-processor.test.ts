import { beforeEach, describe, expect, it } from "vitest";
import { processPendingGraphIndex, enqueueGraphReindex } from "../../server/application/graph-index-processor";
import { getMaintenanceStatus } from "../../server/maintenance/status";
import { R2ObjectStore, type ImmutableObjectStore } from "../../server/storage/r2-object-store";
import { MEMORY_LINK_EXTRACTOR_VERSION } from "../../server/domain/memory-links";
import { resetTestEnv, testEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";

beforeEach(resetTestEnv);

describe("graph index processing", () => {
  it("processes at most ten candidates and isolates failures", async () => {
    const memory = memoryService();
    for (let index = 0; index < 11; index += 1) {
      await memory.store({ project: "graph", namespace: "default", key: `source-${index}`, source: { content: `[target](target-${index}.md)` } });
    }
    await testEnv.DB.prepare("UPDATE memory_link_index SET status = 'pending', next_attempt_at = 0").run();
    const objects = new R2ObjectStore(testEnv.BUCKET);
    let calls = 0;
    const failingOnce: ImmutableObjectStore = {
      putOkf: objects.putOkf.bind(objects),
      getOkf: async (key, hash) => {
        calls += 1;
        if (calls === 1) throw new Error("R2 unavailable");
        return objects.getOkf(key, hash);
      },
    };
    const result = await processPendingGraphIndex(testEnv.DB, failingOnce, 99, 1_000);
    expect(result.selected).toBe(10);
    expect(result.succeeded).toBe(9);
    expect(result.failed).toBe(1);
    expect(await getMaintenanceStatus(testEnv.DB, 1_000)).toMatchObject({ graph: { pending: 1, retrying: 1, truncated: 0 } });
  });

  it("uses revision/hash/index-state CAS so an old read cannot overwrite a new revision", async () => {
    const memory = memoryService();
    await memory.store({ project: "graph", namespace: "default", key: "source", source: { content: "[old](old.md)" } });
    await testEnv.DB.prepare("UPDATE memory_link_index SET status = 'pending', next_attempt_at = 0").run();
    const objects = new R2ObjectStore(testEnv.BUCKET);
    let updated = false;
    const racingStore: ImmutableObjectStore = {
      putOkf: objects.putOkf.bind(objects),
      getOkf: async (key, hash) => {
        const markdown = await objects.getOkf(key, hash);
        if (!updated) {
          updated = true;
          await memory.store({ project: "graph", namespace: "default", key: "source", source: { content: "[new](new.md)" }, expectedRevision: 1 });
        }
        return markdown;
      },
    };
    expect(await processPendingGraphIndex(testEnv.DB, racingStore, 10, 1_000)).toEqual({ selected: 1, succeeded: 0, failed: 0, stale: 1 });
    expect((await testEnv.DB.prepare("SELECT target_key AS targetKey FROM memory_links").all()).results).toEqual([{ targetKey: "new" }]);
  });

  it("automatically rolls over complete rows from an older extractor version", async () => {
    await memoryService().store({ project: "graph", namespace: "default", key: "source", source: { content: "[target](target.md)" } });
    await testEnv.DB.prepare("UPDATE memory_link_index SET extractor_version = 'old-version', status = 'complete'").run();
    expect(await processPendingGraphIndex(testEnv.DB, new R2ObjectStore(testEnv.BUCKET), 10, 1_000)).toEqual({ selected: 1, succeeded: 1, failed: 0, stale: 0 });
    expect(await testEnv.DB.prepare("SELECT extractor_version AS extractorVersion, status FROM memory_link_index").first()).toEqual({ extractorVersion: MEMORY_LINK_EXTRACTOR_VERSION, status: "complete" });
  });

  it("prevents an old extractor worker from overwriting newer-version state", async () => {
    await memoryService().store({ project: "graph", namespace: "default", key: "source", source: { content: "[old](old.md)" } });
    const objects = new R2ObjectStore(testEnv.BUCKET);
    const racingObjects: ImmutableObjectStore = {
      putOkf: objects.putOkf.bind(objects),
      getOkf: async (key, hash) => {
        const markdown = await objects.getOkf(key, hash);
        await testEnv.DB.batch([
          testEnv.DB.prepare("UPDATE memory_link_index SET extractor_version = 'new-worker', status = 'complete'"),
          testEnv.DB.prepare("UPDATE memory_links SET target_key = 'newer'")
        ]);
        return markdown;
      },
    };
    expect(await processPendingGraphIndex(testEnv.DB, racingObjects, 10, 1_000, "old-worker")).toEqual({ selected: 1, succeeded: 0, failed: 0, stale: 1 });
    expect(await testEnv.DB.prepare("SELECT extractor_version AS extractorVersion FROM memory_link_index").first()).toEqual({ extractorVersion: "new-worker" });
    expect(await testEnv.DB.prepare("SELECT target_key AS targetKey FROM memory_links").first()).toEqual({ targetKey: "newer" });
  });

  it("stores and reprocesses the maximum 256 links with 32 tags in bounded statements", async () => {
    const links = Array.from({ length: 256 }, (_, index) => `[${index}](target.md)`).join(" ");
    const tags = Array.from({ length: 32 }, (_, index) => `tag-${index}`);
    await memoryService().store({ project: "graph", namespace: "default", key: "source", source: { content: links }, tags });
    expect(await testEnv.DB.prepare("SELECT count(*) AS count FROM memory_links").first()).toEqual({ count: 256 });
    expect(await testEnv.DB.prepare("SELECT count(*) AS count FROM memory_tags").first()).toEqual({ count: 32 });
    await testEnv.DB.prepare("UPDATE memory_link_index SET status = 'pending', next_attempt_at = 0").run();
    expect(await processPendingGraphIndex(testEnv.DB, new R2ObjectStore(testEnv.BUCKET), 10, 1_000)).toEqual({ selected: 1, succeeded: 1, failed: 0, stale: 0 });
    expect(await testEnv.DB.prepare("SELECT count(*) AS count FROM memory_links").first()).toEqual({ count: 256 });
  });

  it("reindex marks only current indexable canonical records and preserves existing links", async () => {
    const memory = memoryService();
    await memory.store({ project: "graph", namespace: "default", key: "source", source: { content: "[target](target.md)" } });
    await memory.store({ project: "graph", namespace: "default", key: "private", source: { content: "x" }, indexable: false });
    await memory.store({ project: "__workmory_profile__", namespace: "profile", key: "global", source: { content: "x" }, indexable: false });
    const before = await testEnv.DB.prepare("SELECT count(*) AS count FROM memory_links").first<{ count: number }>();
    expect(await enqueueGraphReindex(testEnv.DB, 5_000)).toEqual({ graphMarked: 1 });
    expect(await testEnv.DB.prepare("SELECT count(*) AS count FROM memory_links").first()).toEqual(before);
    expect((await testEnv.DB.prepare("SELECT status FROM memory_link_index").all()).results).toEqual([{ status: "pending" }]);
  });
});
