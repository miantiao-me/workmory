import { beforeEach, describe, expect, it } from "vitest";
import { D1MemoryService } from "../../server/application/d1-memory-service";
import type { ImmutableObjectStore } from "../../server/storage/r2-object-store";
import { accessActor, resetTestEnv, testEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";

beforeEach(resetTestEnv);

describe("D1 memory listing", () => {
  it("isolates owner, project, and namespace", async () => {
    await memoryService(accessActor("owner-a")).store({ project: "alpha", namespace: "default", key: "visible", source: { content: "visible" } });
    await memoryService(accessActor("owner-a")).store({ project: "alpha", namespace: "other", key: "wrong-namespace", source: { content: "hidden" } });
    await memoryService(accessActor("owner-a")).store({ project: "beta", namespace: "default", key: "wrong-project", source: { content: "hidden" } });
    await memoryService(accessActor("owner-b")).store({ project: "alpha", namespace: "default", key: "wrong-owner", source: { content: "hidden" } });

    const result = await memoryService(accessActor("owner-a")).list({ project: "alpha", namespace: "default", limit: 20 });
    expect(result.items.map((item) => item.key)).toEqual(["visible"]);
    expect(result.items[0]).toMatchObject({ project: "alpha", namespace: "default", revision: 1, status: "stable" });
  });

  it("hides deleted, expired, non-indexable, and internal profile records", async () => {
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "visible", source: { content: "visible" } });
    await memory.store({ project: "workmory", namespace: "default", key: "deleted", source: { content: "deleted" } });
    await memory.delete({ project: "workmory", namespace: "default", key: "deleted" });
    await memory.store({ project: "workmory", namespace: "default", key: "expired", source: { content: "expired" } });
    await testEnv.DB.prepare("UPDATE memories SET expires_at = 1 WHERE key = 'expired'").run();
    await memory.store({ project: "workmory", namespace: "default", key: "internal", source: { content: "internal" }, indexable: false });
    await memory.store({ project: "__workmory_profile__", namespace: "profile", key: "global", source: { content: "profile" }, indexable: false });

    expect((await memory.list({ project: "workmory", namespace: "default", limit: 20 })).items.map((item) => item.key)).toEqual(["visible"]);
    expect((await memory.list({ project: "__workmory_profile__", namespace: "profile", limit: 20 })).items).toEqual([]);
  });

  it("keeps rows without search documents and returns fixed-prefix snippets when present", async () => {
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "with-doc", source: { content: "prefix body" } });
    await memory.store({ project: "workmory", namespace: "default", key: "without-doc", source: { content: "still listed" } });
    await testEnv.DB.prepare("DELETE FROM memory_search_docs WHERE key = 'without-doc'").run();

    const result = await memory.list({ project: "workmory", namespace: "default", limit: 20 });
    expect(result.items.find((item) => item.key === "without-doc")).not.toHaveProperty("snippet");
    expect(result.items.find((item) => item.key === "with-doc")?.snippet).toBe("prefix body");
  });

  it("paginates identical timestamps without duplicates and rejects invalid cursors", async () => {
    const memory = memoryService();
    for (const key of ["one", "two", "three"]) {
      await memory.store({ project: "workmory", namespace: "default", key, source: { content: key } });
    }
    await testEnv.DB.prepare("UPDATE memories SET updated_at = 1000").run();

    const keys: string[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await memory.list({ project: "workmory", namespace: "default", limit: 1, cursor });
      keys.push(...page.items.map((item) => item.key));
      cursor = page.nextCursor;
      if (cursor) {
        expect(seenCursors.has(cursor)).toBe(false);
        seenCursors.add(cursor);
      }
    } while (cursor);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    await expect(memory.list({ project: "workmory", namespace: "default", limit: 20, cursor: "invalid" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "memory_list cursor is invalid",
    });
  });

  it("supports any/all tag filters including tags with spaces", async () => {
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "both", source: { content: "both" }, kind: "Decision", tags: ["red", "project alpha"] });
    await memory.store({ project: "workmory", namespace: "default", key: "red", source: { content: "red" }, kind: "Decision", tags: ["red"] });
    await memory.store({ project: "workmory", namespace: "default", key: "blue", source: { content: "blue" }, kind: "Note", tags: ["blue"] });

    const any = await memory.list({
      project: "workmory", namespace: "default", limit: 20,
      filters: { tags: ["project alpha", "blue"], tagMatch: "any" },
    });
    expect(new Set(any.items.map((item) => item.key))).toEqual(new Set(["both", "blue"]));
    const all = await memory.list({
      project: "workmory", namespace: "default", limit: 20,
      filters: { kind: "Decision", status: "stable", tags: ["red", "project alpha"], tagMatch: "all" },
    });
    expect(all.items.map((item) => item.key)).toEqual(["both"]);
    expect(all.items[0]?.tags).toEqual(["project alpha", "red"]);
  });

  it("does not read canonical objects from R2", async () => {
    await memoryService().store({ project: "workmory", namespace: "default", key: "d1-only", source: { content: "listed from D1" } });
    const forbiddenObjects: ImmutableObjectStore = {
      putOkf: async () => { throw new Error("must not write R2"); },
      getOkf: async () => { throw new Error("must not read R2"); },
    };
    const memory = new D1MemoryService(testEnv.DB, forbiddenObjects, accessActor());
    expect((await memory.list({ project: "workmory", namespace: "default", limit: 20 })).items[0]?.key).toBe("d1-only");
  });
});
