import type { MultiDirectedGraph } from "graphology";
import type { MemoryGraphNode, MemoryGraphResult } from "../../lib/api/types";

export const MAX_GRAPH_NODES = 200;
export const MAX_GRAPH_EDGES = 400;

export interface GraphNodeAttributes extends MemoryGraphNode {
  x: number;
  y: number;
  label: string;
  size: number;
}

export interface GraphEdgeAttributes {
  origin: "link" | "source";
  occurrences: number;
  resolved: boolean;
  size: number;
  type: "arrow";
}

export interface GraphFilters {
  search: string;
  kind: string;
  status: string;
  tags: string[];
}

export interface GraphMergeSummary {
  addedNodes: number;
  addedEdges: number;
  nodeLimitReached: boolean;
  edgeLimitReached: boolean;
}

export interface NeighborCursorState {
  cursor?: string;
  exhausted: boolean;
}

export function neighborCursorState(cursor?: string): NeighborCursorState {
  return { ...(cursor ? { cursor } : {}), exhausted: !cursor };
}

export function namespaceForProject(current: string, available: string[]): string {
  return available.includes(current) ? current : available[0] ?? "";
}

function hash32(value: string, seed: number): number {
  let hash = seed | 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function stableNodePosition(key: string): { x: number; y: number } {
  const angle = (hash32(key, 0x811c9dc5) / 0xffffffff) * Math.PI * 2;
  const radius = 1 + (hash32(key, 0x9e3779b9) / 0xffffffff) * 4;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export function graphEdgeKey(origin: "link" | "source", source: string, target: string): string {
  return `${origin}:${source}->${target}`;
}

export function nodeFilterState(node: MemoryGraphNode, filters: GraphFilters): { hidden: boolean; searchMatch: boolean } {
  const hidden = Boolean(
    (filters.kind && node.kind !== filters.kind)
    || (filters.status && node.status !== filters.status)
    || (filters.tags.length && !filters.tags.every((tag) => node.tags.includes(tag)))
  );
  const search = filters.search.trim().toLocaleLowerCase();
  return { hidden, searchMatch: !search || node.key.toLocaleLowerCase().includes(search) };
}

export function clearGraph(graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>): void {
  graph.clear();
}

export function mergeGraphResult(
  graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
  result: MemoryGraphResult,
  limits = { nodes: MAX_GRAPH_NODES, edges: MAX_GRAPH_EDGES },
): GraphMergeSummary {
  let addedNodes = 0;
  let addedEdges = 0;

  for (const dto of result.nodes) {
    const exists = graph.hasNode(dto.key);
    if (!exists && graph.order >= limits.nodes) continue;
    const previous = exists ? graph.getNodeAttributes(dto.key) : undefined;
    if (previous?.resolved && !dto.resolved) continue;
    const position = previous ? { x: previous.x, y: previous.y } : stableNodePosition(dto.key);
    graph.mergeNode(dto.key, {
      ...dto,
      tags: [...dto.tags],
      ...position,
      label: dto.resolved ? dto.key : `? ${dto.key}`,
      size: dto.resolved ? 7 : 4,
    });
    if (!exists) addedNodes += 1;
  }

  for (const dto of result.edges) {
    if (!graph.hasNode(dto.sourceKey) || !graph.hasNode(dto.targetKey)) continue;
    const key = graphEdgeKey(dto.origin, dto.sourceKey, dto.targetKey);
    const exists = graph.hasEdge(key);
    if (!exists && graph.size >= limits.edges) continue;
    graph.mergeDirectedEdgeWithKey(key, dto.sourceKey, dto.targetKey, {
      origin: dto.origin,
      occurrences: dto.occurrences,
      resolved: dto.resolved,
      size: dto.origin === "link" ? 1.5 : 0.75,
      type: "arrow",
    });
    if (!exists) addedEdges += 1;
  }

  return {
    addedNodes,
    addedEdges,
    nodeLimitReached: graph.order >= limits.nodes || result.nodes.some((node) => !graph.hasNode(node.key)),
    edgeLimitReached: graph.size >= limits.edges || result.edges.some((edge) => !graph.hasEdge(graphEdgeKey(edge.origin, edge.sourceKey, edge.targetKey))),
  };
}
