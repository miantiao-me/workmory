import { beforeEach, describe, expect, it } from "vitest";
import { evaluationNow, retrievalCases, retrievalDocuments } from "../evaluation/retrieval-cases";
import { evaluateRanking, summarizeEvaluations } from "../evaluation/retrieval-metrics";
import { resetTestEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";

beforeEach(resetTestEnv);

describe("synthetic local lexical retrieval baseline", () => {
  it("reports judged rankings by group without semantic services or response budget omissions", async () => {
    const memory = memoryService(undefined, { now: () => evaluationNow });
    const scope = { project: "retrieval-evaluation", namespace: "default" };
    for (const document of retrievalDocuments) {
      await memory.store({ ...scope, key: document.key, source: { content: document.content }, frontmatter: { type: "Project Experience" }, tags: document.tags });
    }

    const results = [];
    for (const item of retrievalCases) {
      const response = await memory.search({ ...scope, query: item.query, semanticWeight: 0, limit: 5, maxResponseChars: 100000 });
      const evaluation = evaluateRanking(response.items.map(({ record }) => record.key), new Set(item.relevantKeys));
      results.push({ ...evaluation, id: item.id, group: item.group, query: item.query, omittedItems: response.responseBudget.omittedItems });
    }

    console.log("Synthetic local D1/R2 lexical baseline; semanticWeight=0; fixed now=" + new Date(evaluationNow).toISOString());
    for (const group of ["lexical", "paraphrase", "hard", "negative"] as const) {
      const grouped = results.filter((result) => result.group === group);
      console.log(`${group}: ${JSON.stringify(summarizeEvaluations(grouped))}`);
      for (const result of grouped) {
        console.log(JSON.stringify({ id: result.id, query: result.query, keys: result.keys, recall1: result.metrics?.recall1 ?? null, recall5: result.metrics?.recall5 ?? null, ndcg5: result.metrics?.ndcg5 ?? null, mrr5: result.metrics?.mrr5 ?? null, omittedItems: result.omittedItems }));
      }
    }
    console.log(`overall (positive macro average; see group results): ${JSON.stringify(summarizeEvaluations(results))}`);

    for (const result of results) {
      expect.soft(result.omittedItems, `${result.id}: budget omissions`).toBe(0);
      if (result.group === "lexical") expect.soft(result.metrics?.recall5, `${result.id}: lexical Recall@5`).toBe(1);
      if (result.group === "negative") expect.soft(result.keys, `${result.id}: negative results`).toEqual([]);
    }
    const lexical = summarizeEvaluations(results.filter((result) => result.group === "lexical"));
    expect(lexical.mrr5).toBeGreaterThanOrEqual(0.85);
  });
});
