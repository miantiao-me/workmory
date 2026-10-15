import { describe, expect, it } from "vitest";
import { retrievalCases, retrievalDocuments } from "./evaluation/retrieval-cases";
import { evaluateRanking, summarizeEvaluations } from "./evaluation/retrieval-metrics";

describe("retrieval metrics", () => {
  it("computes hand-calculated non-perfect, multi-relevant rankings", () => {
    const result = evaluateRanking(["noise", "a", "other", "b", "tail"], new Set(["a", "b", "c"]));
    expect(result.metrics).toMatchObject({ recall1: 0, recall3: 1 / 3, recall5: 2 / 3, mrr5: 1 / 2 });
    // Relevant ranks 2 and 4; ideal ranks 1, 2 and 3.
    expect(result.metrics?.ndcg5).toBeCloseTo((1 / Math.log2(3) + 1 / Math.log2(5)) / (1 + 1 / Math.log2(3) + 1 / 2), 12);
  });

  it("handles perfect rankings with fewer than five results", () => {
    expect(evaluateRanking(["a", "b"], new Set(["a", "b"])).metrics)
      .toEqual({ recall1: 0.5, recall3: 1, recall5: 1, mrr5: 1, ndcg5: 1 });
  });

  it("caps ideal gain at five even when gold has more relevant keys", () => {
    const keys = ["a", "b", "c", "d", "e", "f"];
    expect(evaluateRanking(keys, new Set(keys)).metrics)
      .toEqual({ recall1: 1 / 6, recall3: 0.5, recall5: 5 / 6, mrr5: 1, ndcg5: 1 });
  });

  it.each([{ keys: [] }, { keys: ["v", "w", "x", "y", "z", "a"] }])("scores empty or relevant-only-after-five results as zero: $keys", ({ keys }) => {
    expect(evaluateRanking(keys, new Set(["a"])).metrics)
      .toEqual({ recall1: 0, recall3: 0, recall5: 0, mrr5: 0, ndcg5: 0 });
  });

  it("does not count the same relevant document twice", () => {
    const result = evaluateRanking(["a", "a", "b"], new Set(["a", "b"]));
    expect(result.metrics).toMatchObject({ recall1: 0.5, recall3: 1, recall5: 1, mrr5: 1 });
    expect(result.metrics?.ndcg5).toBeCloseTo(1.5 / (1 + 1 / Math.log2(3)), 12);
  });

  it("excludes negative queries from positive macro averages and counts false positives", () => {
    const emptyNegative = evaluateRanking([], new Set());
    const falsePositive = evaluateRanking(["noise"], new Set());
    expect(emptyNegative.metrics).toBeNull();
    expect(falsePositive.metrics).toBeNull();
    expect(summarizeEvaluations([
      evaluateRanking(["a"], new Set(["a"])),
      evaluateRanking([], new Set(["a"])),
      emptyNegative,
      falsePositive,
    ])).toEqual({ positiveQueryCount: 2, negativeQueryCount: 2, falsePositiveQueries: 1, recall1: 0.5, recall3: 0.5, recall5: 0.5, mrr5: 0.5, ndcg5: 0.5 });
    expect(summarizeEvaluations([emptyNegative])).toMatchObject({ positiveQueryCount: 0, recall5: null, mrr5: null, ndcg5: null });
  });
});

describe("manually maintained retrieval judgments", () => {
  it("uses unique stable keys and case ids, with valid positive and negative gold", () => {
    const keys = new Set(retrievalDocuments.map(({ key }) => key));
    expect(keys.size).toBe(retrievalDocuments.length);
    expect(new Set(retrievalCases.map(({ id }) => id)).size).toBe(retrievalCases.length);
    for (const item of retrievalCases) {
      expect(item.query.trim().length, item.id).toBeGreaterThan(0);
      expect(item.intent.trim().length, item.id).toBeGreaterThan(0);
      expect(item.relevantKeys.length === 0, item.id).toBe(item.group === "negative");
      expect(new Set(item.relevantKeys).size, item.id).toBe(item.relevantKeys.length);
      for (const key of item.relevantKeys) expect(keys.has(key), `${item.id}: ${key}`).toBe(true);
      const distractors = item.distractorKeys ?? [];
      if (item.group === "hard") expect(distractors.length, item.id).toBeGreaterThanOrEqual(1);
      expect(new Set(distractors).size, item.id).toBe(distractors.length);
      for (const key of distractors) {
        expect(keys.has(key), `${item.id}: distractor ${key}`).toBe(true);
        expect(item.relevantKeys.includes(key), `${item.id}: disjoint gold and distractor`).toBe(false);
      }
    }
    for (const group of ["lexical", "paraphrase", "hard", "negative"] as const) {
      expect(retrievalCases.filter((item) => item.group === group).length, group).toBeGreaterThanOrEqual(2);
    }
    expect(retrievalCases.filter((item) => item.group === "lexical" && item.relevantKeys.length > 1).length).toBeGreaterThanOrEqual(2);
  });
});
