import { describe, expect, it } from "vitest";
import type { MemoryRecord } from "../server/domain/memory";
import { candidateDepth, weightedRrf, type RankedCandidate } from "../server/search/rrf";

function candidate(id: string): RankedCandidate {
  const record: MemoryRecord = {
    project: "project",
    namespace: "default",
    key: id,
    revision: 1,
    tags: [],
  };
  return { id, record };
}

describe("weighted reciprocal rank fusion", () => {
  it("honors weight boundaries without mixing raw similarity scores", () => {
    const lexical = [candidate("lexical"), candidate("shared")];
    const semantic = [candidate("semantic"), candidate("shared")];
    expect(weightedRrf({ lexical, semantic, semanticWeight: 0, limit: 3 })[0].record.key).toBe("lexical");
    expect(weightedRrf({ lexical, semantic, semanticWeight: 1, limit: 3 })[0].record.key).toBe("semantic");
    expect(weightedRrf({ lexical, semantic, semanticWeight: 0.5, limit: 3 })[0].record.key).toBe("shared");
  });

  it("keeps exact keys ahead of RRF scores", () => {
    const result = weightedRrf({
      lexical: [candidate("other"), candidate("exact")],
      semantic: [candidate("other")],
      exactIds: new Set(["exact"]),
      semanticWeight: 1,
      limit: 2,
    });
    expect(result[0].record.key).toBe("exact");
  });

  it("deduplicates, uses compressed input ranks, and has stable ties", () => {
    const result = weightedRrf({
      lexical: [candidate("b"), candidate("b"), candidate("a")],
      semantic: [],
      semanticWeight: 0,
      limit: 10,
    });
    expect(result.map((hit) => hit.record.key)).toEqual(["b", "a"]);
    expect(result[1].scoreBreakdown?.lexicalRank).toBe(2);

    const tied = weightedRrf({
      lexical: [],
      semantic: [candidate("a"), candidate("b")],
      semanticWeight: 0,
      limit: 10,
    });
    expect(tied.map((hit) => hit.record.key)).toEqual(["a", "b"]);
  });

  it("keeps the lexical record for hybrid duplicates without changing fusion scores", () => {
    const lexical = candidate("shared");
    lexical.record.content = "query-relative lexical snippet";
    const semantic = candidate("shared");
    semantic.record.content = "fixed semantic prefix";

    const [result] = weightedRrf({
      lexical: [lexical],
      semantic: [semantic],
      semanticWeight: 0.5,
      limit: 1,
    });

    expect(result.record.content).toBe("query-relative lexical snippet");
    expect(result.score).toBeCloseTo(1 / 61);
    expect(result.scoreBreakdown).toEqual({
      lexical: 0.5 / 61,
      semantic: 0.5 / 61,
      lexicalRank: 1,
      semanticRank: 1,
    });
  });

  it("bounds candidate depth", () => {
    expect(candidateDepth(1)).toBe(50);
    expect(candidateDepth(20)).toBe(100);
    expect(candidateDepth(50)).toBe(100);
  });
});
