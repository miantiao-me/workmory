import type { MemoryScope } from "./identity";

export type JsonObject = Record<string, unknown>;
export type MemoryContentSource =
  | { content: string }
  | { okf_markdown: string }
  | { attachment_id: string }
  | { source_url: string };

export interface MemoryRecord {
  project: string;
  namespace: string;
  key: string;
  revision: number;
  kind?: string;
  tags: string[];
  status?: string;
  okfMarkdown?: string;
  content?: string;
  attachmentIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface MutationResult {
  key: string;
  revision?: number;
  deleted?: boolean;
  operationId?: string;
}

export interface SearchHit {
  record: MemoryRecord;
  score: number;
  scoreBreakdown?: {
    lexical?: number;
    semantic?: number;
    lexicalRank?: number;
    semanticRank?: number;
  };
}

export interface SearchResult {
  items: SearchHit[];
  degraded: boolean;
  effectiveSemanticWeight: number;
  degradationReason?: string;
  degradationCode?: "semantic_runtime_unconfigured" | "semantic_unavailable" | "projection_incomplete";
  semanticProjectionCoverage?: { eligible: number; projected: number; complete: boolean };
}

export interface MemoryListItem {
  project: string;
  namespace: string;
  key: string;
  revision: number;
  kind?: string;
  tags: string[];
  status?: string;
  snippet?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MemoryListResult {
  items: MemoryListItem[];
  nextCursor?: string;
}

export interface SearchMemoryRequest extends MemoryScope {
  query: string;
  semanticWeight: number;
  limit: number;
  filters?: { kind?: string; tags?: string[]; status?: string };
}
