import type { SearchMemoryRequest } from "../domain/memory";
import { memoryFilterClauses } from "../application/memory-query-support";
import type { RankedCandidate } from "./rrf";

export interface CandidateRow {
  memoryId: string;
  revision: number;
  key: string;
  tags: string;
  kind: string | null;
  status: string;
  snippet: string;
  updatedAt: number;
}

export function toCandidate(candidate: CandidateRow, request: SearchMemoryRequest): RankedCandidate {
  return {
    id: String(candidate.memoryId),
    record: {
      project: request.project,
      namespace: request.namespace,
      key: String(candidate.key),
      revision: Number(candidate.revision),
      kind: candidate.kind === null ? undefined : String(candidate.kind),
      tags: JSON.parse(String(candidate.tags ?? "[]")) as string[],
      status: String(candidate.status),
      content: String(candidate.snippet),
      updatedAt: new Date(Number(candidate.updatedAt)).toISOString(),
    },
  };
}

export function buildSearchFilters(request: SearchMemoryRequest, alias = "s") {
  // kind/status filter the memory_search_docs snapshot columns (alias `s`);
  // the tags EXISTS joins through the memories table alias `m` inside
  // memoryFilterClauses. `alias` stays caller-controlled for flexibility.
  return memoryFilterClauses(request.filters ?? {}, alias);
}
