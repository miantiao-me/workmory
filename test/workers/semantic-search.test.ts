import { beforeEach, describe, expect, it } from "vitest";
import { queryLexicalCandidates, queryLexicalSubstringCandidates } from "../../server/search/lexical-candidates";
import { accessActor, resetTestEnv, testEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";

beforeEach(resetTestEnv);

describe("lexical and FTS search", () => {
  it("loads tags from memory_tags without splitting spaces or Unicode", async () => {
    const memory = memoryService();
    await memory.store({
      project: "workmory", namespace: "default", key: "tags/round-trip",
      source: { content: "tag projection" }, tags: ["two words", "界面 偏好"],
    });
    const result = await memory.search({ project: "workmory", namespace: "default", query: "tag projection", semanticWeight: 0, limit: 20 });
    expect(result.items[0].record.tags).toEqual(["two words", "界面 偏好"]);
  });

  it("searches exact keys, tags, and Chinese text with trigram FTS", async () => {
    const memory = memoryService();
    await memory.store({
      project: "workmory",
      namespace: "default",
      key: "preferences/theme",
      source: { content: "用户偏好深色模式和高对比度。" },
      tags: ["界面偏好"],
    });
    expect((await memory.search({ project: "workmory", namespace: "default", query: "preferences/theme", semanticWeight: 0, limit: 20 })).items).toHaveLength(1);
    expect((await memory.search({ project: "workmory", namespace: "default", query: "界面偏好", semanticWeight: 0, limit: 20 })).items).toHaveLength(1);
    expect((await memory.search({ project: "workmory", namespace: "default", query: "深色模式", semanticWeight: 0, limit: 20 })).items).toHaveLength(1);
  });

  it("returns a plain query-relative FTS snippet for matches beyond the fixed prefix", async () => {
    const memory = memoryService();
    const prefix = "opening text ".repeat(100);
    const query = "distant searchable phrase";
    await memory.store({
      project: "workmory",
      namespace: "default",
      key: "search/distant",
      source: { content: `${prefix}${query} trailing text` },
    });

    const result = await memory.search({ project: "workmory", namespace: "default", query, semanticWeight: 0, limit: 20 });

    expect(prefix.length).toBeGreaterThan(1_000);
    expect(prefix.length).toBeLessThan(16_384);
    expect(result.items[0].record.content).toContain(query);
    expect(result.items[0].record.content).not.toBe(`${prefix}${query} trailing text`.slice(0, 1_000));
    expect(result.items[0].record.content).not.toMatch(/<\/?(?:b|mark)>|\*\*|\[fts-match-(?:start|end)\]/i);
  });

  it("uses the fixed prefix when FTS matches only a key or tag", async () => {
    const memory = memoryService();
    const prefix = "fixed body prefix [fts-match-start]";
    await memory.store({
      project: "workmory",
      namespace: "default",
      key: "topic/key-only-needle",
      source: { content: `${prefix} without the lookup term` },
      tags: ["tag-only-needle"],
    });

    const keyResult = await memory.search({ project: "workmory", namespace: "default", query: "key-only-needle", semanticWeight: 0, limit: 20 });
    const tagResult = await memory.search({ project: "workmory", namespace: "default", query: "tag-only", semanticWeight: 0, limit: 20 });

    expect(keyResult.items[0].record.content).toBe(`${prefix} without the lookup term`);
    expect(tagResult.items[0].record.content).toBe(`${prefix} without the lookup term`);
  });

  it("supports content fallback queries longer than D1's LIKE pattern limit", async () => {
    const memory = memoryService();
    const query = "long-fallback-query-".repeat(4);
    await memory.store({
      project: "workmory",
      namespace: "default",
      key: "search/long-fallback",
      source: { content: `before ${query} after` },
    });

    const candidates = await queryLexicalSubstringCandidates(
      testEnv.DB,
      accessActor("subject-a"),
      { project: "workmory", namespace: "default", query, semanticWeight: 0, limit: 20 },
      50,
    );

    expect(new TextEncoder().encode(query).byteLength).toBeGreaterThan(50);
    expect(candidates.map((candidate) => candidate.record.key)).toEqual(["search/long-fallback"]);
    expect(candidates[0].record.content).toBe(`before ${query} after`);
  });

  it("uses instr for queries shorter than three Unicode code points", async () => {
    const memory = memoryService();
    await memory.store({
      project: "workmory",
      namespace: "default",
      key: "search/short-query",
      source: { content: "你好世界" },
    });
    const db = new Proxy(testEnv.DB, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            if (sql.includes("memory_search_fts MATCH")) throw new Error("FTS must not run for short queries");
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const { ranked } = await queryLexicalCandidates(
      db,
      accessActor("subject-a"),
      { project: "workmory", namespace: "default", query: "好", semanticWeight: 0, limit: 20 },
      50,
    );

    expect(ranked.map((candidate) => candidate.record.key)).toEqual(["search/short-query"]);
  });

  it("escapes quotes in FTS phrases", async () => {
    const memory = memoryService();
    await memory.store({
      project: "workmory",
      namespace: "default",
      key: "search/quoted-phrase",
      source: { content: 'before quoted "phrase" after' },
    });

    const result = await memory.search({
      project: "workmory",
      namespace: "default",
      query: 'quoted "phrase"',
      semanticWeight: 0,
      limit: 20,
    });

    expect(result.items.map((item) => item.record.key)).toEqual(["search/quoted-phrase"]);
  });

  it("propagates FTS prepare failures without silently degrading", async () => {
    const memory = memoryService();
    const query = "long-fallback-query-".repeat(4);
    await memory.store({
      project: "workmory",
      namespace: "default",
      key: "search/forced-fts-fallback",
      source: { content: `before ${query} after` },
    });
    const failure = new Error("forced FTS failure");
    const db = new Proxy(testEnv.DB, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            if (sql.includes("memory_search_fts MATCH")) throw failure;
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(queryLexicalCandidates(
      db,
      accessActor("subject-a"),
      { project: "workmory", namespace: "default", query, semanticWeight: 0, limit: 20 },
      50,
    )).rejects.toBe(failure);
  });
});
