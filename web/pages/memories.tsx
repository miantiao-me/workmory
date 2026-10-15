import { useEffect, useMemo, useState } from "react";
import { FilePlus2, RefreshCw, SearchIcon, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MemoryRecord } from "../../server/domain/memory";
import { AppHeader, AppHeaderActions, AppHeaderContent, AppHeaderDescription } from "../components/app/app-header";
import { ContextSelect, ErrorAlert } from "../components/common";
import { MemoryDetailDialog, MemoryEditorDialog } from "@/components/dialogs";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { useApp } from "../context/app-context";
import { useCopyWithNotice } from "../hooks/use-copy-with-notice";
import { useMemoryDetail } from "../hooks/use-memory-detail";
import { errorMessage, makeOperationId, parseTagsInput, stableIdentifier, UserFacingError } from "../lib/presentation";
import { MemoryFilters } from "./memories/memory-filters";
import { MemoryResults } from "./memories/memory-results";
import { useMemoryResults } from "./memories/use-memory-results";

export function MemoriesPage() {
  const { t } = useTranslation();
  const {
    api,
    defaultProject,
    defaultNamespace,
    handleApiError,
    notify,
    projectDirectory,
    projectDirectoryLoading,
    projectDirectoryError,
    refreshProjectDirectory,
  } = useApp();
  const [project, setProject] = useState(defaultProject);
  const [namespace, setNamespace] = useState(defaultNamespace);
  const scopeKey = `${project}${namespace}`;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MemoryRecord>();
  const [editorScope, setEditorScope] = useState({ project: defaultProject, namespace: defaultNamespace });
  const [deleting, setDeleting] = useState(false);
  const copyWithNotice = useCopyWithNotice();
  const results = useMemoryResults({ project, namespace });
  const {
    rows, loading, error, load, setError,
    query, setQuery, isSearching,
    semanticWeight, setSemanticWeight,
    draftFilters, setDraftFilters, appliedFilters, appliedFilterTags, activeFilterCount,
    degraded, responseBudget, cursorHistory, nextCursor, resetPage, previousPage, nextPage,
  } = results;
  const {
    detail,
    open: detailOpen,
    loading: detailLoading,
    close: closeDetail,
    retrieve: retrieveDetail,
    setDetail,
    setDialogOpen,
  } = useMemoryDetail({ scopeKey, onError: setError });

  const projectOptions = useMemo(() => projectDirectory.map((entry) => entry.project), [projectDirectory]);
  const namespaceOptions = useMemo(
    () => projectDirectory.find((entry) => entry.project === project)?.namespaces ?? [],
    [projectDirectory, project],
  );

  // 默认上下文变化：重置分页并关闭编辑器/详情，避免旧 scope 的编辑目标漂移
  useEffect(() => {
    closeDetail();
    setEditorOpen(false);
    setEditing(undefined);
    resetPage();
    setProject(defaultProject);
    setNamespace(defaultNamespace);
  }, [closeDetail, defaultNamespace, defaultProject, resetPage]);

  function selectContext(kind: "project" | "namespace", rawValue: string) {
    let next: string;
    try {
      next = stableIdentifier(
        rawValue,
        t(kind === "project" ? "common.fields.project" : "common.fields.namespace"),
        kind === "project" ? 128 : 64,
      );
    } catch {
      return;
    }
    if (kind === "project" ? next === project : next === namespace) return;
    closeDetail();
    resetPage();
    // 页面 scope 变化时关闭编辑器，防止向旧 scope 目标写入
    setEditorOpen(false);
    setEditing(undefined);
    if (kind === "project") setProject(next);
    else setNamespace(next);
  }

  async function openDetail(key: string) {
    setError("");
    await retrieveDetail({ project, namespace, key }, { missingError: () => new UserFacingError(t("memories.validation.missing")) });
  }

  function openNew() { setEditing(undefined); setEditorScope({ project, namespace }); setEditorOpen(true); }
  function openEdit(record: MemoryRecord) { setEditing(record); setEditorScope({ project: record.project, namespace: record.namespace }); closeDetail(); setEditorOpen(true); }

  async function remove(record: MemoryRecord) {
    if (deleting) return;
    setDeleting(true);
    try {
      // 删除以记录自身的 scope 为目标，避免页面 scope 变化后误删其他记录
      await api.memoryDelete({ project: record.project, namespace: record.namespace, key: record.key, expected_revision: record.revision, operation_id: makeOperationId("memory-delete") });
      closeDetail();
      notify(t("memories.notifications.deleted"));
      void refreshProjectDirectory();
      await load();
    } catch (cause) {
      handleApiError(cause);
      setError(errorMessage(cause));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <AppHeader>
        <AppHeaderContent title={t("memories.title")}>
          <AppHeaderDescription>{t("memories.description")}</AppHeaderDescription>
        </AppHeaderContent>
        <AppHeaderActions>
          <Button loading={loading} onClick={() => void load()} variant="outline">
            <RefreshCw aria-hidden="true" />{t("memories.refresh")}
          </Button>
          <Button onClick={openNew}>
            <FilePlus2 aria-hidden="true" />{t("memories.create")}
          </Button>
        </AppHeaderActions>
      </AppHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
            <InputGroup className="w-full sm:max-w-sm">
              <InputGroupInput
                aria-label={t("memories.search")}
                maxLength={2_000}
                onChange={(event) => { setQuery(event.target.value); resetPage(); }}
                placeholder={t("memories.searchPlaceholder")}
                type="search"
                value={query}
              />
              <InputGroupAddon>
                <SearchIcon aria-hidden="true" />
              </InputGroupAddon>
            </InputGroup>

            <MemoryFilters
              activeFilterCount={activeFilterCount}
              draft={draftFilters}
              onDraftChange={setDraftFilters}
              onSemanticWeightChange={setSemanticWeight}
              searchActive={isSearching}
              semanticWeight={semanticWeight}
            />

            <ContextSelect
              className="w-44 shrink-0"
              disabled={projectDirectoryLoading}
              kind="project"
              onValueChange={(value) => selectContext("project", value)}
              options={projectOptions}
              showLabel
              value={project}
            />
            <ContextSelect
              className="w-40 shrink-0"
              disabled={projectDirectoryLoading}
              kind="namespace"
              onValueChange={(value) => selectContext("namespace", value)}
              options={namespaceOptions}
              showLabel
              value={namespace}
            />
            {activeFilterCount > 0 && (
              <>
              {appliedFilters.kind && <Badge className="shrink-0" onClick={() => setDraftFilters((draft) => ({ ...draft, kind: "" }))} render={<button type="button" />} variant="secondary">{t("memories.kind")}: {appliedFilters.kind}<X aria-hidden="true" /></Badge>}
              {appliedFilters.status && <Badge className="shrink-0" onClick={() => setDraftFilters((draft) => ({ ...draft, status: "" }))} render={<button type="button" />} variant="secondary">{t("memories.status")}: {appliedFilters.status}<X aria-hidden="true" /></Badge>}
              {appliedFilterTags.map((tag) => <Badge className="shrink-0" key={tag} onClick={() => setDraftFilters((draft) => ({ ...draft, tags: parseTagsInput(draft.tags).filter((value) => value !== tag).join(", ") }))} render={<button type="button" />} variant="secondary">{t("memories.tags")}: {tag}<X aria-hidden="true" /></Badge>)}
              {isSearching && semanticWeight !== 0.5 && <Badge className="shrink-0" onClick={() => setSemanticWeight(0.5)} render={<button type="button" />} variant="secondary">{t("memories.currentWeight", { weight: semanticWeight.toFixed(2) })}<X aria-hidden="true" /></Badge>}
              </>
            )}
        </div>

        {degraded.active && <Alert variant="warning"><AlertTitle>{t("memories.degraded.title")}</AlertTitle><AlertDescription>{degraded.reason || t("memories.degraded.fallback")} {t("memories.degraded.weight", { weight: degraded.effectiveWeight?.toFixed(2) ?? "—" })}</AlertDescription></Alert>}
        {error && <ErrorAlert message={error} onRetry={() => void load()} />}
        {projectDirectoryError && <ErrorAlert message={t("shell.projectOverview.error")} onRetry={() => void refreshProjectDirectory()} />}

        <MemoryResults
          cursorHistory={cursorHistory}
          hasError={Boolean(error)}
          isSearching={isSearching}
          loading={loading}
          nextCursor={nextCursor}
          onNextPage={nextPage}
          onOpen={(key) => void openDetail(key)}
          onOpenNew={openNew}
          onPreviousPage={previousPage}
          rows={rows}
          responseBudget={responseBudget}
        />
      </div>

      <MemoryEditorDialog current={editing} namespace={editorScope.namespace} onOpenChange={setEditorOpen} onSaved={async (record) => { setEditorOpen(false); notify(editing ? t("memories.notifications.revised") : t("memories.notifications.created")); setDetail(record); void refreshProjectDirectory(); await load(); }} open={editorOpen} project={editorScope.project} />

      <MemoryDetailDialog
        deleting={deleting}
        detail={detail}
        loading={detailLoading}
        onCopy={(key) => copyWithNotice(key, t("memories.notifications.keyCopied"))}
        onDelete={(record) => void remove(record)}
        onEdit={openEdit}
        onOpenChange={setDialogOpen}
        open={detailOpen}
      />
    </>
  );
}
