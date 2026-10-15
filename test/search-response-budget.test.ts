import { describe, expect, it } from "vitest";
import type { SearchHit, SearchResult } from "../server/domain/memory";
import { finalizeSearchResult, normalizeSearchResponseChars } from "../server/search/response-budget";

function hit(snippet: string, key = "key", tags: string[] = []): SearchHit {
  return { record: { project: "project", namespace: "default", key, revision: 1, tags, snippet }, score: 1 / 61, scoreBreakdown: { lexical: 1 / 61, lexicalRank: 1 } };
}
const metadata = {
  degraded: true,
  effectiveSemanticWeight: 0,
  degradationCode: "semantic_unavailable" as const,
  degradationReason: "Semantic search unavailable; lexical results returned",
  semanticProjectionCoverage: { eligible: 11, projected: 9, complete: false },
};

describe("search response budget", () => {
  it("counts the complete result JSON at exact boundaries with Unicode and escapes", () => {
    const items = [hit('界😀\n\t"\\'.repeat(100), "long/" + "k".repeat(300), ["tag".repeat(20)]), hit("second")];
    const full = finalizeSearchResult({ ...metadata, items }, 100000);
    const boundary = JSON.stringify({ ...full, responseBudget: { maxChars: 4000, omittedItems: 0 } }).length;
    expect(boundary).toBeGreaterThanOrEqual(2000);
    const exact = finalizeSearchResult({ ...metadata, items }, boundary);
    expect(exact.items).toEqual(items);
    expect(JSON.stringify(exact).length).toBe(boundary);
    const below = finalizeSearchResult({ ...metadata, items }, boundary - 1);
    expect(below.items).toEqual(items.slice(0, 1));
    expect(below.responseBudget.omittedItems).toBe(1);
    expect(JSON.stringify(below).length).toBeLessThanOrEqual(boundary - 1);
    expect(below).toMatchObject(metadata);
    expect(new TextEncoder().encode(JSON.stringify(exact)).length).toBeGreaterThan(boundary);
  });

  it("keeps a ranked complete prefix and includes long keys and tags in the budget", () => {
    const items = [hit("first"), hit("second", "k".repeat(1500), ["t".repeat(1000)]), hit("small third")];
    const result = finalizeSearchResult({ ...metadata, items }, 2000);
    expect(result.items).toEqual([items[0]]);
    expect(result.responseBudget).toEqual({ maxChars: 2000, omittedItems: 2 });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000);
    expect(result.items[0]).toBe(items[0]);
  });

  it("returns empty items for an oversized first result without skipping to smaller hits", () => {
    const items = [hit("x".repeat(2000)), hit("small")];
    const result = finalizeSearchResult({ ...metadata, items }, 2000);
    expect(result.items).toEqual([]);
    expect(result.responseBudget.omittedItems).toBe(2);
    expect(result).toMatchObject(metadata);
    expect(finalizeSearchResult({ items: [], degraded: false, effectiveSemanticWeight: 0 })).toEqual({
      items: [], degraded: false, effectiveSemanticWeight: 0, responseBudget: { maxChars: 16000, omittedItems: 0 },
    });
  });

  it("uses the final omission digit count when ten omitted results become nine", () => {
    const items = [hit("x".repeat(1400)), ...Array.from({ length: 9 }, () => hit("x".repeat(3000)))];
    const expected: SearchResult = { ...metadata, items: [items[0]], responseBudget: { maxChars: 2000, omittedItems: 9 } };
    const padding = 2000 - JSON.stringify(expected).length;
    items[0].record.snippet += "x".repeat(padding);
    expect(JSON.stringify(expected).length).toBe(2000);
    const result = finalizeSearchResult({ ...metadata, items }, 2000);
    expect(result).toEqual(expected);
    expect(result.items[0].score).toBe(items[0].score);
    expect(result.items[0].scoreBreakdown).toEqual(items[0].scoreBreakdown);
  });

  it("normalizes direct service budgets", () => {
    for (const value of [undefined, NaN, Infinity, -Infinity]) expect(normalizeSearchResponseChars(value)).toBe(16000);
    expect(normalizeSearchResponseChars(2000.9)).toBe(2000);
    expect(normalizeSearchResponseChars(4567.9)).toBe(4567);
    expect(normalizeSearchResponseChars(-100)).toBe(2000);
    expect(normalizeSearchResponseChars(100001)).toBe(100000);
  });
});
