import { describe, expect, it } from "vitest";
import { MultiDirectedGraph } from "graphology";
import type { MemoryGraphResult } from "../web/lib/api/types";
import {
  graphEdgeKey,
  mergeGraphResult,
  namespaceForProject,
  neighborCursorState,
  nodeFilterState,
  stableNodePosition,
  type GraphEdgeAttributes,
  type GraphNodeAttributes,
} from "../web/pages/graph/model";

function result(nodes: MemoryGraphResult["nodes"], edges: MemoryGraphResult["edges"] = []): MemoryGraphResult {
  return {
    mode: "overview",
    nodes,
    edges,
    truncated: false,
    truncationReasons: [],
    coverage: { complete: true, pendingSources: 0, truncatedSources: 0 },
  };
}

describe("graph view model", () => {
  it("derives stable positions from node keys", () => {
    expect(stableNodePosition("alpha")).toEqual(stableNodePosition("alpha"));
    expect(stableNodePosition("alpha")).not.toEqual(stableNodePosition("beta"));
  });

  it("incrementally merges copied DTO data and preserves coordinates", () => {
    const graph = new MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>();
    const dto = result([{ key: "a", resolved: false, tags: [] }]);
    mergeGraphResult(graph, dto);
    const position = { x: graph.getNodeAttribute("a", "x"), y: graph.getNodeAttribute("a", "y") };
    mergeGraphResult(graph, result([{ key: "a", resolved: true, tags: ["one"], revision: 2 }]));
    dto.nodes[0].tags.push("dto-only");

    expect(graph.getNodeAttributes("a")).toMatchObject({ resolved: true, revision: 2, tags: ["one"], ...position });
  });

  it("uses stable origin-aware keys for parallel relationships", () => {
    const graph = new MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>();
    mergeGraphResult(graph, result(
      [{ key: "a", resolved: true, tags: [] }, { key: "b", resolved: true, tags: [] }],
      [
        { sourceKey: "a", targetKey: "b", origin: "link", occurrences: 1, resolved: true },
        { sourceKey: "a", targetKey: "b", origin: "source", occurrences: 1, resolved: true },
      ],
    ));

    expect(graph.edges()).toEqual(expect.arrayContaining([graphEdgeKey("link", "a", "b"), graphEdgeKey("source", "a", "b")]));
    expect(graph.size).toBe(2);
  });

  it("enforces client node and edge limits", () => {
    const graph = new MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>();
    const merged = mergeGraphResult(graph, result(
      [{ key: "a", resolved: true, tags: [] }, { key: "b", resolved: true, tags: [] }, { key: "c", resolved: true, tags: [] }],
      [
        { sourceKey: "a", targetKey: "b", origin: "link", occurrences: 1, resolved: true },
        { sourceKey: "b", targetKey: "a", origin: "link", occurrences: 1, resolved: true },
      ],
    ), { nodes: 2, edges: 1 });

    expect(graph.order).toBe(2);
    expect(graph.size).toBe(1);
    expect(merged).toMatchObject({ nodeLimitReached: true, edgeLimitReached: true });
  });

  it("dims search misses but hides structured-filter misses", () => {
    const node = { key: "alpha", resolved: true, tags: ["important"], kind: "note", status: "active" };
    expect(nodeFilterState(node, { search: "beta", kind: "", status: "", tags: [] })).toEqual({ hidden: false, searchMatch: false });
    expect(nodeFilterState(node, { search: "alpha", kind: "task", status: "", tags: [] })).toEqual({ hidden: true, searchMatch: true });
    expect(nodeFilterState(node, { search: "", kind: "note", status: "active", tags: ["important"] })).toEqual({ hidden: false, searchMatch: true });
  });

  it("marks neighbor pagination exhausted instead of repeating the first page", () => {
    expect(neighborCursorState("next-page")).toEqual({ cursor: "next-page", exhausted: false });
    expect(neighborCursorState()).toEqual({ exhausted: true });
  });

  it("keeps a valid namespace or selects the first namespace for a new project", () => {
    expect(namespaceForProject("notes", ["default", "notes"])).toBe("notes");
    expect(namespaceForProject("old", ["default", "notes"])).toBe("default");
    expect(namespaceForProject("old", [])).toBe("");
  });
});
