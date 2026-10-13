export type MemoryGraphDirection = "outbound" | "inbound" | "both";
export type MemoryGraphTruncationReason = "node_limit" | "edge_limit";

export interface MemoryGraphNode {
  key: string;
  resolved: boolean;
  tags: string[];
  revision?: number;
  kind?: string;
  status?: string;
  updatedAt?: string;
}

export interface MemoryGraphEdge {
  sourceKey: string;
  targetKey: string;
  origin: "link" | "source";
  occurrences: number;
  resolved: boolean;
}

export interface MemoryGraphCoverage {
  complete: boolean;
  pendingSources: number;
  truncatedSources: number;
}

export interface MemoryGraphResult {
  mode: "overview" | "neighbors";
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  nextCursor?: string;
  truncated: boolean;
  truncationReasons: MemoryGraphTruncationReason[];
  coverage: MemoryGraphCoverage;
}

export type MemoryGraphRequest =
  | { mode: "overview"; project: string; namespace: string; nodeLimit: number; edgeLimit: number; cursor?: string }
  | {
      mode: "neighbors";
      project: string;
      namespace: string;
      rootKey: string;
      direction: MemoryGraphDirection;
      includeBroken: boolean;
      edgeLimit: number;
      cursor?: string;
    };

// Graph cursors carry scope + key fields that legitimately exceed 512 bytes.
export const MEMORY_GRAPH_CURSOR_MAX_LENGTH = 2048;
