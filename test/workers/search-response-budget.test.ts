import { beforeEach, describe, expect, it } from "vitest";
import { searchInputSchema } from "../../server/mcp/memory-contracts";
import { createMemoryToolHandlers } from "../../server/mcp/memory-tools";
import { processPendingOutbox } from "../../server/search/outbox-processor";
import { accessActor, resetTestEnv, testEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";
import { semanticRuntime, vectorIds } from "./semantic-search-helpers";

beforeEach(resetTestEnv);

describe("search response budget through D1 and MCP", () => {
  it.each(["lexical", "hybrid", "unconfigured", "unavailable", "incomplete"] as const)("bounds the complete %s result without changing ranking", async (mode) => {
    const { runtime, embeddings, vectors } = semanticRuntime();
    const memory = memoryService(accessActor("subject-a"), { semantic: mode === "unconfigured" ? undefined : runtime });
    for (let index = 0; index < 4; index += 1) {
      await memory.store({ project: "workmory", namespace: "default", key: `budget/${index}`, source: { content: `needle ${"界😀\\\"".repeat(300)}` }, tags: Array.from({ length: 12 }, (_, tag) => `${tag}-${"t".repeat(58)}`) });
    }
    if (mode !== "incomplete" && mode !== "unconfigured") {
      await processPendingOutbox(testEnv.DB, runtime, 10);
      vectors.queryMatches = (await vectorIds()).map((id) => ({ id }));
    }
    embeddings.fail = mode === "unavailable";
    const request = { project: "workmory", namespace: "default", query: "needle", semanticWeight: mode === "lexical" ? 0 : 0.5, limit: 3 };
    const full = await memory.search({ ...request, maxResponseChars: 100000 });
    const result = await memory.search({ ...request, maxResponseChars: 2000 });
    expect(full.items).toHaveLength(3);
    expect(result.items.length).toBeLessThan(3);
    expect(result.items).toEqual(full.items.slice(0, result.items.length));
    expect(result.responseBudget).toEqual({ maxChars: 2000, omittedItems: 3 - result.items.length });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000);
    const { items: _items, responseBudget: _budget, ...metadata } = full;
    expect(result).toMatchObject(metadata);
    const codes = { lexical: undefined, hybrid: undefined, unconfigured: "semantic_runtime_unconfigured", unavailable: "semantic_unavailable", incomplete: "projection_incomplete" };
    expect(result.degradationCode).toBe(codes[mode]);
  });

  it("returns omissions instead of false zero matches when the first result exceeds budget", async () => {
    const memory = memoryService();
    await memory.store({ project: "workmory", namespace: "default", key: "oversized/first", source: { content: "oversized" }, tags: Array.from({ length: 32 }, (_, index) => `${index}-${"t".repeat(58)}`) });
    await memory.store({ project: "workmory", namespace: "default", key: "small/second", source: { content: "oversized/first" } });
    const result = await memory.search({ project: "workmory", namespace: "default", query: "oversized/first", semanticWeight: 0, limit: 1, maxResponseChars: 2000 });
    expect(result.items).toEqual([]);
    expect(result.responseBudget).toEqual({ maxChars: 2000, omittedItems: 1 });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000);
  });

  it("normalizes absent, nonfinite, fractional and out of range direct budgets", async () => {
    const memory = memoryService();
    const request = { project: "workmory", namespace: "default", query: "empty", semanticWeight: 0, limit: 20 };
    for (const [maxResponseChars, expected] of [[undefined, 16000], [NaN, 16000], [Infinity, 16000], [-Infinity, 16000], [4567.9, 4567], [-1, 2000], [100001, 100000]] as const) {
      const result = await memory.search({ ...request, maxResponseChars });
      expect(result.responseBudget).toEqual({ maxChars: expected, omittedItems: 0 });
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(expected);
    }
  });

  it("returns excerpts through MCP search while retrieve preserves full content", async () => {
    const memory = memoryService();
    const content = `needle ${"complete body ".repeat(200)}`;
    const scope = { project: "workmory", namespace: "default", key: "budget/full" };
    await memory.store({ ...scope, source: { content } });
    const handlers = createMemoryToolHandlers(memory);
    const searched = await handlers.memory_search(searchInputSchema.parse({ project: scope.project, query: "budget/full", semantic_weight: 0 }));
    expect(searched.structuredContent).toMatchObject({ result: { responseBudget: { maxChars: 16000, omittedItems: 0 }, items: [{ record: { snippet: content.slice(0, 1000) } }] } });
    const searchText = searched.content[1];
    if (searchText.type !== "text") throw new Error("Expected JSON text content");
    const searchData = JSON.parse(searchText.text);
    expect(searchData).toEqual(JSON.parse(JSON.stringify(searched.structuredContent)));
    expect(searchData.result.items[0].record.snippet).toBe(content.slice(0, 1000));
    expect(searchData.result.items[0].record).not.toHaveProperty("content");
    expect(searchData.result.items[0].record).not.toHaveProperty("okfMarkdown");
    expect(JSON.stringify(searchData.result).length).toBeLessThanOrEqual(searchData.result.responseBudget.maxChars);
    const result = await memory.search({ ...scope, query: "budget/full", semanticWeight: 0, limit: 20 });
    expect(result.items[0].record).not.toHaveProperty("content");
    expect(result.items[0].record).not.toHaveProperty("okfMarkdown");
    const retrieved = await handlers.memory_retrieve(scope);
    expect(retrieved.structuredContent).toMatchObject({ record: { content, okfMarkdown: expect.stringContaining(content) } });
    const retrieveText = retrieved.content[1];
    if (retrieveText.type !== "text") throw new Error("Expected JSON text content");
    expect(JSON.parse(retrieveText.text)).toEqual(JSON.parse(JSON.stringify(retrieved.structuredContent)));
    expect(JSON.parse(retrieveText.text)).toMatchObject({ record: { content, okfMarkdown: expect.stringContaining(content) } });
  });
});
