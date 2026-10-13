import { useCallback, useEffect, useMemo, useState } from "react";
import { GitFork, Maximize2, Minus, Plus, RefreshCw, Search, UnfoldVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppHeader, AppHeaderActions, AppHeaderContent, AppHeaderDescription } from "../components/app/app-header";
import { EmptyState, ErrorAlert, LoadingState } from "../components/common";
import { MemoryDetailDialog } from "../components/dialogs";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardFrame, CardFrameDescription, CardFrameFooter, CardFrameHeader, CardFrameTitle, CardPanel } from "../components/ui/card";
import { Drawer, DrawerHeader, DrawerPanel, DrawerPopup, DrawerTitle } from "../components/ui/drawer";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../components/ui/tabs";
import { useApp } from "../context/app-context";
import { useCopyWithNotice } from "../hooks/use-copy-with-notice";
import { useMediaQuery } from "../hooks/use-media-query";
import { parseTagsInput } from "../lib/presentation";
import { nodeFilterState, type GraphFilters } from "./graph/model";
import { GraphCanvas, supportsWebGL } from "./graph/graph-canvas";
import { GraphLegend } from "./graph/graph-legend";
import { GraphToolbar } from "./graph/graph-toolbar";
import { NodeDetails } from "./graph/node-details";
import { GraphNodeList } from "./graph/node-list";
import { useMemoryGraph } from "./graph/use-memory-graph";

export function GraphPage() {
  const { t } = useTranslation();
  const { projectDirectory, projectDirectoryError, projectDirectoryLoading, refreshProjectDirectory } = useApp();
  const mobile = useMediaQuery("max-md");
  const {
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
    initialLoading,
    memoryDetail,
    memoryDetailLoading,
    memoryDetailOpen,
    setDetailDialogOpen,
    loadOverview,
    expandNode,
    openMemory,
    selectContext,
  } = useMemoryGraph();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [tags, setTags] = useState("");
  const [webglAvailable, setWebglAvailable] = useState(() => supportsWebGL());
  const [mobileTab, setMobileTab] = useState<"graph" | "list">(() => supportsWebGL() ? "graph" : "list");
  const copyWithNotice = useCopyWithNotice();

  const handleCanvasFailure = useCallback(() => setWebglAvailable(false), []);

  const projectOptions = useMemo(() => projectDirectory.map((entry) => entry.project), [projectDirectory]);
  const projectEntry = useMemo(() => projectDirectory.find((entry) => entry.project === project), [projectDirectory, project]);
  const namespaceOptions = projectEntry?.namespaces ?? [];
  const filterTags = useMemo(() => parseTagsInput(tags), [tags]);
  const filters = useMemo<GraphFilters>(() => ({ search, kind, status, tags: filterTags }), [filterTags, kind, search, status]);
  const visibleNodes = useMemo(() => nodes.filter((node) => !nodeFilterState(node, filters).hidden), [filters, nodes]);

  useEffect(() => {
    if (!webglAvailable) setMobileTab("list");
  }, [webglAvailable]);

  function zoom(multiplier: number) {
    const camera = sigmaRef.current?.getCamera();
    if (!camera) return;
    camera.animate({ ratio: camera.getState().ratio * multiplier });
  }

  const canvasProps = { filters, graph, hovered, onFailure: handleCanvasFailure, onHover: setHovered, onSelect: setSelected, selected, sigmaRef, structureVersion };
  const detailProps = { busy: neighborBusy, exhausted: Boolean(selectedNode && neighborCursors[selectedNode.key]?.exhausted), node: selectedNode, onExpand: () => selectedNode && void expandNode(selectedNode.key), onOpenMemory: () => void openMemory(), onSelect: setSelected, relations: selectedRelations };
  const list = <GraphNodeList filters={filters} nodes={visibleNodes} onSelect={setSelected} selected={selected} />;

  return (
    <>
      <AppHeader>
        <AppHeaderContent title={t("graph.title")}>
          <AppHeaderDescription>{t("graph.description")}</AppHeaderDescription>
        </AppHeaderContent>
        <AppHeaderActions>
          <Button loading={overviewBusy} onClick={() => void loadOverview()} variant="outline">
            <RefreshCw aria-hidden="true" />{t("graph.refresh")}
          </Button>
        </AppHeaderActions>
      </AppHeader>
      <div className="flex flex-col gap-4">
        <GraphToolbar
          direction={direction}
          directoryLoading={projectDirectoryLoading}
          includeBroken={includeBroken}
          kind={kind}
          kinds={kinds}
          namespace={namespace}
          namespaceOptions={namespaceOptions}
          onDirectionChange={setDirection}
          onKindChange={setKind}
          onSearchChange={setSearch}
          onSelectContext={selectContext}
          onStatusChange={setStatus}
          onTagsChange={setTags}
          onToggleBroken={() => setIncludeBroken((value) => !value)}
          project={project}
          projectOptions={projectOptions}
          search={search}
          status={status}
          statuses={statuses}
          tags={tags}
        />

        {error && <ErrorAlert message={error} onRetry={() => void loadOverview()} />}
        {projectDirectoryError && <ErrorAlert message={t("shell.projectOverview.error")} onRetry={() => void refreshProjectDirectory()} />}
        {!coverage.complete && <Alert variant="info"><AlertTitle>{t("graph.notices.incompleteTitle")}</AlertTitle><AlertDescription>{t("graph.notices.incomplete", { pending: String(coverage.pendingSources), truncated: String(coverage.truncatedSources) })}</AlertDescription></Alert>}
        {serverTruncated && <Alert variant="warning"><AlertTitle>{t("graph.notices.truncatedTitle")}</AlertTitle><AlertDescription>{t("graph.notices.truncated")}</AlertDescription></Alert>}
        {atClientLimit && <Alert variant="warning"><AlertTitle>{t("graph.notices.clientLimitTitle")}</AlertTitle><AlertDescription>{t("graph.notices.clientLimit")}</AlertDescription></Alert>}
        {!webglAvailable && <Alert variant="warning"><AlertTitle>{t("graph.notices.fallbackTitle")}</AlertTitle><AlertDescription>{t("graph.notices.fallback")}</AlertDescription></Alert>}
        {!overviewBusy && loadedScope === scopeKey && nodes.length > 0 && graph.size === 0 && <Alert variant="info"><AlertTitle>{t("graph.notices.noRelationshipsTitle")}</AlertTitle><AlertDescription>{t("graph.notices.noRelationships")}</AlertDescription></Alert>}

        <div aria-live="polite" className="sr-only">{t("graph.summary", { nodes: String(graph.order), edges: String(graph.size) })}</div>
        {initialLoading ? (
          <LoadingState rows={6} />
        ) : nodes.length === 0 ? (
          <CardFrame className="min-h-72"><EmptyState description={t("graph.empty.scopeDescription")} icon={<GitFork aria-hidden="true" />} title={t("graph.empty.scopeTitle")} /></CardFrame>
        ) : visibleNodes.length === 0 ? (
          <CardFrame className="min-h-72"><EmptyState description={t("graph.empty.filtersDescription")} icon={<Search aria-hidden="true" />} title={t("graph.empty.filtersTitle")} /></CardFrame>
        ) : (
          <div className="flex flex-col gap-4 md:flex-row">
            <CardFrame className="min-w-0 flex-1 overflow-hidden">
              <CardFrameHeader>
                <CardFrameTitle>{t("graph.summary", { nodes: String(graph.order), edges: String(graph.size) })}</CardFrameTitle>
                <CardFrameDescription>{t("graph.visibleSummary", { visible: String(visibleNodes.length), total: String(nodes.length) })}</CardFrameDescription>
              </CardFrameHeader>
              <Card className="flex-1">
                <CardPanel className="flex flex-1 flex-col p-0">
                  <p className="sr-only" id="memory-graph-instructions">{t("graph.instructions")}</p>
                  {mobile ? (
                    <Tabs className="min-h-0 flex-1" onValueChange={(value) => setMobileTab(value as "graph" | "list")} value={mobileTab}>
                      <TabsList className="mx-3 mt-3"><TabsTab disabled={!webglAvailable} value="graph">{t("graph.tabs.graph")}</TabsTab><TabsTab value="list">{t("graph.tabs.list")}</TabsTab></TabsList>
                      <TabsPanel aria-describedby="memory-graph-instructions" aria-label={t("graph.regionLabel")} className="min-h-80" role="region" value="graph">{webglAvailable && <GraphCanvas key={scopeKey} {...canvasProps} />}</TabsPanel>
                      <TabsPanel className="min-h-0 overflow-auto p-0" value="list">{list}</TabsPanel>
                    </Tabs>
                  ) : webglAvailable ? <div aria-describedby="memory-graph-instructions" aria-label={t("graph.regionLabel")} className="min-h-96 flex-1" role="region"><GraphCanvas key={scopeKey} {...canvasProps} /></div> : <div className="min-h-96 overflow-auto">{list}</div>}
                </CardPanel>
              </Card>
              <CardFrameFooter className="relative flex flex-wrap items-center justify-between gap-2">
                <GraphLegend />
                <div className="flex gap-1">
                  <Button aria-label={t("graph.zoomIn")} disabled={!webglAvailable} onClick={() => zoom(0.75)} size="icon-sm" title={t("graph.zoomIn")} variant="outline"><Plus aria-hidden="true" /></Button>
                  <Button aria-label={t("graph.zoomOut")} disabled={!webglAvailable} onClick={() => zoom(1.25)} size="icon-sm" title={t("graph.zoomOut")} variant="outline"><Minus aria-hidden="true" /></Button>
                  <Button aria-label={t("graph.fit")} disabled={!webglAvailable} onClick={() => sigmaRef.current?.getCamera().animatedReset()} size="icon-sm" title={t("graph.fit")} variant="outline"><Maximize2 aria-hidden="true" /></Button>
                  {selectedNode?.resolved && <Button disabled={neighborCursors[selectedNode.key]?.exhausted} loading={neighborBusy} onClick={() => void expandNode(selectedNode.key)} size="sm" variant="outline"><UnfoldVertical aria-hidden="true" />{neighborCursors[selectedNode.key]?.exhausted ? t("graph.expandExhausted") : t("graph.expand")}</Button>}
                  {nextCursor && !atClientLimit && <Button loading={overviewBusy} onClick={() => void loadOverview(nextCursor)} size="sm" variant="outline">{overviewBusy ? t("graph.loadingMore") : t("graph.loadMore")}</Button>}
                </div>
              </CardFrameFooter>
            </CardFrame>

            <div className="hidden gap-4 md:flex md:w-80 md:shrink-0 md:flex-col">
              <CardFrame className="shrink-0"><CardFrameHeader><CardFrameTitle>{t("graph.detail.title")}</CardFrameTitle></CardFrameHeader><Card><CardPanel><NodeDetails {...detailProps} /></CardPanel></Card></CardFrame>
              <CardFrame className="min-h-0 flex-1"><CardFrameHeader><CardFrameTitle>{t("graph.tabs.list")}</CardFrameTitle><CardFrameDescription>{t("graph.visibleSummary", { visible: String(visibleNodes.length), total: String(nodes.length) })}</CardFrameDescription></CardFrameHeader><Card className="min-h-0 flex-1"><CardPanel className="min-h-0 overflow-auto p-0">{list}</CardPanel></Card></CardFrame>
            </div>
          </div>
        )}
      </div>

      <Drawer onOpenChange={(open) => { if (!open) setSelected(undefined); }} open={mobile && Boolean(selected)} position="bottom"><DrawerPopup showCloseButton><DrawerHeader><DrawerTitle>{t("graph.detail.title")}</DrawerTitle></DrawerHeader><DrawerPanel><NodeDetails {...detailProps} /></DrawerPanel></DrawerPopup></Drawer>
      <MemoryDetailDialog detail={memoryDetail} loading={memoryDetailLoading} onCopy={(key) => copyWithNotice(key, t("memories.notifications.keyCopied"))} onOpenChange={setDetailDialogOpen} open={memoryDetailOpen} readOnly />
    </>
  );
}
