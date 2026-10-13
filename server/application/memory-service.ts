import type {
  JsonObject,
  MemoryContentSource,
  MemoryListResult,
  MemoryRecord,
  MutationResult,
  SearchResult,
  SearchMemoryRequest,
} from "../domain/memory";
import type { MemoryScope } from "../domain/identity";
import type { MemoryGraphRequest, MemoryGraphResult } from "./graph-contract";

export interface StoreMemoryRequest extends MemoryScope {
  key: string;
  source: MemoryContentSource;
  frontmatter?: JsonObject;
  kind?: string;
  tags?: string[];
  provenance?: JsonObject;
  expectedRevision?: number;
  operationId?: string;
  /** Internal-only. Public MCP contracts intentionally do not expose this field. */
  indexable?: boolean;
  /** Internal-only precomputed operation receipt fingerprint. */
  operationFingerprint?: string;
}

export interface RetrieveMemoryRequest extends MemoryScope {
  key: string;
}

export interface MemoryHistoryRequest extends RetrieveMemoryRequest {
  limit: number;
  cursor?: string;
}

export interface MemoryRevisionMetadata {
  revision: number;
  action: "upsert" | "delete";
  contentHash: string;
  createdAt: string;
}

export interface MemoryHistoryResult {
  items: MemoryRevisionMetadata[];
  nextCursor?: string;
}

export interface RetrieveMemoryRevisionRequest extends RetrieveMemoryRequest {
  revision: number;
}

export interface MemoryRevisionResult {
  revision: MemoryRevisionMetadata;
  record: MemoryRecord | null;
}

export interface RestoreMemoryRequest extends RetrieveMemoryRequest {
  sourceRevision: number;
  expectedRevision?: number;
  operationId: string;
}

export interface ListMemoryRequest extends MemoryScope {
  limit: number;
  cursor?: string;
  filters?: {
    kind?: string;
    status?: string;
    tags?: string[];
    tagMatch?: "any" | "all";
  };
}

export interface DeleteMemoryRequest extends MemoryScope {
  key: string;
  expectedRevision?: number;
  operationId?: string;
  /** Internal-only precomputed operation receipt fingerprint. */
  operationFingerprint?: string;
}

export interface UpdateLastMemoryRequest extends MemoryScope {
  content: string;
  summary?: string;
  expectedRevision?: number;
  operationId?: string;
}

export interface CompletedOperationReplayRequest extends MemoryScope {
  key: string;
  action: "upsert" | "delete";
  operationId?: string;
  operationFingerprint: string;
}

export type CompletedOperationReplayResult =
  | { action: "upsert"; record: MemoryRecord }
  | { action: "delete"; result: MutationResult }
  | null;

export interface CompletedOperationReplay {
  replayCompletedOperation(request: CompletedOperationReplayRequest): Promise<CompletedOperationReplayResult>;
}

export interface MemoryService {
  store(request: StoreMemoryRequest): Promise<MemoryRecord>;
  retrieve(request: RetrieveMemoryRequest): Promise<MemoryRecord | null>;
  history(request: MemoryHistoryRequest): Promise<MemoryHistoryResult>;
  retrieveRevision(request: RetrieveMemoryRevisionRequest): Promise<MemoryRevisionResult>;
  restore(request: RestoreMemoryRequest): Promise<MemoryRecord>;
  list(request: ListMemoryRequest): Promise<MemoryListResult>;
  search(request: SearchMemoryRequest): Promise<SearchResult>;
  delete(request: DeleteMemoryRequest): Promise<MutationResult>;
  getLast(request: MemoryScope): Promise<MemoryRecord | null>;
  updateLast(request: UpdateLastMemoryRequest): Promise<MemoryRecord>;
  graph(request: MemoryGraphRequest): Promise<MemoryGraphResult>;
}

export type {
  MemoryGraphCoverage,
  MemoryGraphDirection,
  MemoryGraphEdge,
  MemoryGraphNode,
  MemoryGraphRequest,
  MemoryGraphResult,
  MemoryGraphTruncationReason,
} from "./graph-contract";

export type ReplayableMemoryService = MemoryService & CompletedOperationReplay;

export type MemoryErrorCode =
  | "NOT_FOUND"
  | "REVISION_CONFLICT"
  | "REVISION_NOT_FOUND"
  | "REVISION_NOT_RESTORABLE"
  | "OPERATION_CONFLICT"
  | "INVALID_INPUT"
  | "UNAVAILABLE"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export class MemoryServiceError extends Error {
  constructor(
    public readonly code: MemoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MemoryServiceError";
  }
}
