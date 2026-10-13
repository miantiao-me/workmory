import type { MemoryRecord, SearchHit } from "../domain/memory";

export interface RankedCandidate {
  id: string;
  record: MemoryRecord;
}

export interface RrfInput {
  lexical: RankedCandidate[];
  semantic: RankedCandidate[];
  exactIds?: ReadonlySet<string>;
  semanticWeight: number;
  limit: number;
}

function unique(candidates: RankedCandidate[]): RankedCandidate[] {
  const seen = new Set<string>();
  const result: RankedCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    result.push(candidate);
  }
  return result;
}

export function weightedRrf(input: RrfInput): SearchHit[] {
  const weight = Math.min(1, Math.max(0, input.semanticWeight));
  const lexical = unique(input.lexical);
  const semantic = unique(input.semantic);
  const records = new Map([...semantic, ...lexical].map((candidate) => [candidate.id, candidate.record]));
  const lexicalRanks = new Map(lexical.map((candidate, index) => [candidate.id, index + 1]));
  const semanticRanks = new Map(semantic.map((candidate, index) => [candidate.id, index + 1]));

  return [...records.entries()]
    .map(([id, record]) => {
      const lexicalRank = lexicalRanks.get(id);
      const semanticRank = semanticRanks.get(id);
      const lexicalScore = lexicalRank === undefined ? 0 : (1 - weight) / (60 + lexicalRank);
      const semanticScore = semanticRank === undefined ? 0 : weight / (60 + semanticRank);
      return {
        id,
        exact: input.exactIds?.has(id) ?? false,
        lexicalRank,
        semanticRank,
        hit: {
          record,
          score: lexicalScore + semanticScore,
          scoreBreakdown: { lexical: lexicalScore, semantic: semanticScore, lexicalRank, semanticRank },
        } satisfies SearchHit,
      };
    })
    .sort(
      (left, right) =>
        Number(right.exact) - Number(left.exact) ||
        right.hit.score - left.hit.score ||
        (left.lexicalRank ?? Number.MAX_SAFE_INTEGER) - (right.lexicalRank ?? Number.MAX_SAFE_INTEGER) ||
        (left.semanticRank ?? Number.MAX_SAFE_INTEGER) - (right.semanticRank ?? Number.MAX_SAFE_INTEGER) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, input.limit)
    .map(({ hit }) => hit);
}

export function candidateDepth(limit: number): number {
  return Math.min(100, Math.max(50, Math.trunc(limit) * 5));
}
