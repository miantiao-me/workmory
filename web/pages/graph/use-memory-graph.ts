import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MultiDirectedGraph } from "graphology";
import type Sigma from "sigma";
import { useTranslation } from "react-i18next";
import { useApp } from "../../context/app-context";
import { useMemoryDetail } from "../../hooks/use-memory-detail";
import type { MemoryGraphCoverage, MemoryGraphDirection } from "../../lib/api/types";
import { errorMessage, RequestGeneration, stableIdentifier } from "../../lib/presentation";
import type { NodeRelation } from "./node-details";
import {
  clearGraph,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  mergeGraphResult,
  namespaceForProject,
  neighborCursorState,
  type GraphEdgeAttributes,
  type GraphNodeAttributes,
} from "./model";

const EMPTY_COVERAGE: MemoryGraphCoverage = { complete: true, pendingSources: 0, truncatedSources: 0 };

export function useMemoryGraph() {
  const { t } = useTranslation();
  const { api, defaultProject, defaultNamespace, handleApiError, projectDirectory, projectDirectoryLoading } = useApp();
  const [graph] = useState(() => new MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>());
  const [project, setProject] = useState(defaultProject);
  const [namespace, setNamespace] = useState(defaultNamespace);
  const [direction, setDirection] = useState<MemoryGraphDirection>("both");
  const [includeBroken, setIncludeBroken] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const [overviewBusy, setOverviewBusy] = useState(true);
  const [neighborBusy, setNeighborBusy] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string>();
  const [neighborCursors, setNeighborCursors] = useState<Record<string, { cursor?: string; exhausted: boolean }>>({});
  const [coverage, setCoverage] = useState(EMPTY_COVERAGE);
  const [serverTruncated, setServerTruncated] = useState(false);
  const [loadedScope, setLoadedScope] = useState<string>();
  // dataVersion 标记派生数据（节点属性/筛选结果）变化；structureVersion 仅标记拓扑变化以驱动布局
  const [dataVersion, setDataVersion] = useState(0);
  const [structureVersion, setStructureVersion] = useState(0);
  const [directoryReady, setDirectoryReady] = useState(false);
  const overviewRequests = useRef(new RequestGeneration());
  const neighborRequests = useRef(new RequestGeneration());
  const activeScope = useRef(`${defaultProject}\u0000${defaultNamespace}`);
  const previousDefaults = useRef(`${defaultProject}\u0000${defaultNamespace}`);
  const sigmaRef = useRef<Sigma<GraphNodeAttributes, GraphEdgeAttributes> | null>(null);

  const projectEntry = useMemo(() => projectDirectory.find((entry) => entry.project === project), [projectDirectory, project]);
  const { detail: memoryDetail, open: memoryDetailOpen, loading: memoryDetailLoading, close: closeMemoryDetail, retrieve: retrieveMemoryDetail, setDialogOpen: setDetailDialogOpen } = useMemoryDetail({ scopeKey: `${project}\u0000${namespace}`, onError: setError });
  const nodes = useMemo(() => graph.nodes().map((key) => graph.getNodeAttributes(key)), [graph, dataVersion]);
  const kinds = useMemo(() => [...new Set(nodes.flatMap((node) => node.kind ? [node.kind] : []))].sort(), [nodes]);
  const statuses = useMemo(() => [...new Set(nodes.flatMap((node) => node.status ? [node.status] : []))].sort(), [nodes]);
  const selectedNode = selected && graph.hasNode(selected) ? graph.getNodeAttributes(selected) : undefined;
  const atClientLimit = graph.order >= MAX_GRAPH_NODES || graph.size >= MAX_GRAPH_EDGES;
  const scopeKey = `${project}\u0000${namespace}`;
  // 选中节点的边列表随属性更新变化，因此挂在 dataVersion 上；structureVersion 只驱动布局
  const selectedRelations = useMemo<NodeRelation[]>(() => {
    if (!selected || !graph.hasNode(selected)) return [];
    const relations: NodeRelation[] = [];
    graph.forEachInEdge(selected, (_edge, attributes, source) => relations.push({
      key: source,
      direction: "incoming",
      origin: attributes.origin,
      occurrences: attributes.occurrences,
      resolved: graph.getNodeAttribute(source, "resolved"),
    }));
    graph.forEachOutEdge(selected, (_edge, attributes, _source, target) => relations.push({
      key: target,
      direction: "outgoing",
      origin: attributes.origin,
      occurrences: attributes.occurrences,
      resolved: graph.getNodeAttribute(target, "resolved"),
    }));
    return relations;
  }, [graph, selected, dataVersion]);
  const scopeNeedsCorrection = Boolean(projectEntry?.namespaces.length && !projectEntry.namespaces.includes(namespace));
  const initialLoading = loadedScope !== scopeKey && (!directoryReady || projectDirectoryLoading || overviewBusy || scopeNeedsCorrection);

  const applyGraphResult = useCallback((resultGraph: Parameters<typeof mergeGraphResult>[1], replace: boolean) => {
    if (replace) {
      // 刷新语义：清空旧图再合并，保证已删除/变更的关系不会残留
      clearGraph(graph);
      setSelected(undefined);
      setHovered(undefined);
      setNeighborCursors({});
      closeMemoryDetail();
      mergeGraphResult(graph, resultGraph);
      setDataVersion((value) => value + 1);
      setStructureVersion((value) => value + 1);
      return;
    }
    const merged = mergeGraphResult(graph, resultGraph);
    setDataVersion((value) => value + 1);
    if (merged.addedNodes || merged.addedEdges) setStructureVersion((value) => value + 1);
  }, [closeMemoryDetail, graph]);

  const loadOverview = useCallback(async (cursor?: string) => {
    if (!project || !namespace) return;
    const requestScope = `${project}\u0000${namespace}`;
    const token = overviewRequests.current.issue();
    setOverviewBusy(true);
    setError("");
    try {
      const result = await api.memoryGraph({
        mode: "overview",
        project: stableIdentifier(project, t("common.fields.project"), 128),
        namespace: stableIdentifier(namespace, t("common.fields.namespace"), 64),
        node_limit: 50,
        edge_limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (!overviewRequests.current.isCurrent(token) || activeScope.current !== requestScope) return;
      applyGraphResult(result.graph, !cursor);
      setNextCursor(result.graph.nextCursor);
      setServerTruncated(result.graph.truncated);
      setCoverage(result.graph.coverage);
      setLoadedScope(requestScope);
    } catch (cause) {
      if (!overviewRequests.current.isCurrent(token) || activeScope.current !== requestScope) return;
      handleApiError(cause);
      setError(errorMessage(cause));
    } finally {
      if (overviewRequests.current.isCurrent(token) && activeScope.current === requestScope) setOverviewBusy(false);
    }
  }, [api, applyGraphResult, handleApiError, namespace, project, t]);

  const clearScopeState = useCallback((nextProject: string, nextNamespace: string) => {
    overviewRequests.current.invalidate();
    neighborRequests.current.invalidate();
    closeMemoryDetail();
    setOverviewBusy(false);
    setNeighborBusy(false);
    clearGraph(graph);
    setSelected(undefined);
    setHovered(undefined);
    setNextCursor(undefined);
    setNeighborCursors({});
    setCoverage(EMPTY_COVERAGE);
    setServerTruncated(false);
    setLoadedScope(undefined);
    setError("");
    setDataVersion((value) => value + 1);
    setStructureVersion((value) => value + 1);
    activeScope.current = `${nextProject}\u0000${nextNamespace}`;
  }, [closeMemoryDetail, graph]);

  const switchScope = useCallback((nextProject: string, nextNamespace: string) => {
    if (nextProject === project && nextNamespace === namespace) return;
    clearScopeState(nextProject, nextNamespace);
    setProject(nextProject);
    setNamespace(nextNamespace);
  }, [clearScopeState, namespace, project]);

  const selectContext = useCallback((type: "project" | "namespace", value: string) => {
    if (type === "project") {
      const namespaces = projectDirectory.find((entry) => entry.project === value)?.namespaces ?? [];
      switchScope(value, namespaceForProject(namespace, namespaces));
    } else {
      switchScope(project, value);
    }
  }, [namespace, project, projectDirectory, switchScope]);

  const expandNode = useCallback(async (key: string) => {
    if (atClientLimit) return;
    const cursorState = neighborCursors[key];
    if (cursorState?.exhausted) return;
    const requestScope = scopeKey;
    const token = neighborRequests.current.issue();
    setNeighborBusy(true);
    setError("");
    try {
      const result = await api.memoryGraph({
        mode: "neighbors",
        project: stableIdentifier(project, t("common.fields.project"), 128),
        namespace: stableIdentifier(namespace, t("common.fields.namespace"), 64),
        root_key: key,
        direction,
        include_broken: includeBroken,
        edge_limit: 100,
        ...(cursorState?.cursor ? { cursor: cursorState.cursor } : {}),
      });
      if (!neighborRequests.current.isCurrent(token) || activeScope.current !== requestScope) return;
      applyGraphResult(result.graph, false);
      setNeighborCursors((values) => ({ ...values, [key]: neighborCursorState(result.graph.nextCursor) }));
      setServerTruncated(result.graph.truncated);
      setCoverage(result.graph.coverage);
    } catch (cause) {
      if (!neighborRequests.current.isCurrent(token) || activeScope.current !== requestScope) return;
      handleApiError(cause);
      setError(errorMessage(cause));
    } finally {
      if (neighborRequests.current.isCurrent(token) && activeScope.current === requestScope) setNeighborBusy(false);
    }
  }, [api, applyGraphResult, atClientLimit, direction, handleApiError, includeBroken, namespace, neighborCursors, project, scopeKey, t]);

  const openMemory = useCallback(async () => {
    if (!selectedNode?.resolved) return;
    await retrieveMemoryDetail({ project, namespace, key: selectedNode.key });
  }, [namespace, project, retrieveMemoryDetail, selectedNode]);

  useEffect(() => {
    if (!directoryReady || projectDirectoryLoading || !project || !namespace || (projectEntry && !projectEntry.namespaces.includes(namespace))) {
      setOverviewBusy(false);
      return;
    }
    void loadOverview();
  }, [directoryReady, loadOverview, namespace, project, projectDirectoryLoading, projectEntry]);
  useEffect(() => () => {
    overviewRequests.current.invalidate();
    neighborRequests.current.invalidate();
    closeMemoryDetail();
  }, [closeMemoryDetail]);
  // 仅在默认值本身变化时同步 scope；switchScope 依赖当前 project/namespace，
  // 若直接做依赖，用户手动切换后 effect 会再次触发并把 scope 弹回默认值
  useEffect(() => {
    const defaults = `${defaultProject}\u0000${defaultNamespace}`;
    if (defaults === previousDefaults.current) return;
    previousDefaults.current = defaults;
    switchScope(defaultProject, defaultNamespace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultNamespace, defaultProject]);
  useEffect(() => {
    if (projectDirectoryLoading) {
      setDirectoryReady(true);
      return;
    }
    const timer = window.setTimeout(() => setDirectoryReady(true), 0);
    return () => window.clearTimeout(timer);
  }, [projectDirectoryLoading]);
  useEffect(() => {
    if (projectDirectoryLoading) return;
    const entry = projectDirectory.find((item) => item.project === project);
    if (!entry || entry.namespaces.includes(namespace)) return;
    switchScope(project, entry.namespaces[0] ?? "");
  }, [namespace, project, projectDirectory, projectDirectoryLoading, switchScope]);
  useEffect(() => {
    neighborRequests.current.invalidate();
    setNeighborBusy(false);
    setNeighborCursors({});
  }, [direction, includeBroken]);

  return {
    graph,
    sigmaRef,
    project,
    namespace,
    direction,
    setDirection,
    includeBroken,
    setIncludeBroken,
    selected,
    setSelected,
    hovered,
    setHovered,
    overviewBusy,
    neighborBusy,
    error,
    nextCursor,
    neighborCursors,
    coverage,
    serverTruncated,
    loadedScope,
    structureVersion,
    nodes,
    kinds,
    statuses,
    selectedNode,
    selectedRelations,
    atClientLimit,
    scopeKey,
    scopeNeedsCorrection,
    initialLoading,
    memoryDetail,
    memoryDetailLoading,
    memoryDetailOpen,
    setDetailDialogOpen,
    loadOverview,
    expandNode,
    openMemory,
    selectContext,
  };
}
