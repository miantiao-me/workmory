import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Flag, Pencil, RefreshCw, Settings2 } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { MemoryRecord } from "../lib/api/types";
import { EmptyState, ErrorAlert } from "../components/common";
import { CheckpointEditorDialog } from "@/components/dialogs";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardAction, CardDescription, CardFrame, CardFrameFooter, CardHeader, CardPanel, CardTitle } from "../components/ui/card";
import { Separator } from "../components/ui/separator";
import { Skeleton } from "../components/ui/skeleton";
import { useApp } from "../context/app-context";
import { checkpointExpectedRevision, checkpointSummary, ContextRequestGeneration, errorMessage, makeOperationId, operationIdFromInput, stableIdentifier, UserFacingError } from "../lib/presentation";

function CheckpointSkeleton() {
  const { t } = useTranslation();

  return (
    <div aria-busy="true" aria-live="polite" className="grid gap-4" role="status">
      <span className="sr-only">{t("common.loading")}</span>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Skeleton aria-hidden="true" className="h-4 w-28" />
          <Skeleton aria-hidden="true" className="mt-1 h-5 w-full max-w-72" />
        </div>
        <Skeleton aria-hidden="true" className="h-5 w-20 rounded-full" />
      </div>
      <Separator />
      <div>
        <Skeleton aria-hidden="true" className="h-4 w-20" />
        <div className="mt-2 grid gap-2">
          <Skeleton aria-hidden="true" className="h-4 w-full" />
          <Skeleton aria-hidden="true" className="h-4 w-11/12" />
          <Skeleton aria-hidden="true" className="h-4 w-4/5" />
        </div>
      </div>
    </div>
  );
}

export function CheckpointCard({ project, namespace, onPendingChange }: { project: string; namespace: string; onPendingChange: (pending: boolean) => void }) {
  const location = useLocation();
  const { t } = useTranslation();
  const { api, handleApiError, notify, refreshProjectDirectory } = useApp();
  const [checkpoint, setCheckpoint] = useState<MemoryRecord | null>();
  const [content, setContent] = useState("");
  const [summary, setSummary] = useState("");
  const [currentSummary, setCurrentSummary] = useState("");
  const [operationId, setOperationId] = useState(() => makeOperationId("checkpoint-update"));
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [committedContextKey, setCommittedContextKey] = useState<string>();
  const requests = useRef(new ContextRequestGeneration());
  const contextKey = JSON.stringify([project.trim(), namespace.trim()]);
  requests.current.setContext(contextKey);
  const contextReady = committedContextKey === contextKey;
  const currentCheckpoint = contextReady ? checkpoint : undefined;
  const canEdit = contextReady && !loading && !loadFailed;

  const load = useCallback(async () => {
    const token = requests.current.issue(contextKey);
    setCommittedContextKey(undefined);
    setCheckpoint(undefined);
    setEditorOpen(false);
    setLoading(true);
    setPending(false);
    onPendingChange(false);
    setError("");
    setLoadFailed(false);
    try {
      const validatedProject = stableIdentifier(project, t("common.fields.project"), 128);
      const validatedNamespace = stableIdentifier(namespace, t("common.fields.namespace"), 64);
      const result = await api.memoryGetLast({ project: validatedProject, namespace: validatedNamespace });
      const returnedSummary = await checkpointSummary(result.record?.okfMarkdown);
      if (!requests.current.isCurrent(token)) return;
      setCheckpoint(result.record);
      setContent(result.record?.content ?? "");
      setSummary(returnedSummary ?? "");
      setCurrentSummary(returnedSummary ?? "");
      setOperationId(makeOperationId("checkpoint-update"));
      setCommittedContextKey(contextKey);
    } catch (cause) {
      if (!requests.current.isCurrent(token)) return;
      setCommittedContextKey(contextKey);
      handleApiError(cause);
      setError(errorMessage(cause));
      setLoadFailed(true);
    } finally {
      if (requests.current.isCurrent(token)) setLoading(false);
    }
  }, [api, contextKey, handleApiError, namespace, onPendingChange, project, t]);

  useEffect(() => {
    void load();
    return () => requests.current.invalidate();
  }, [load]);

  function openEditor() {
    if (!canEdit) return;
    setContent(currentCheckpoint?.content ?? "");
    setSummary(currentSummary);
    setError("");
    setEditorOpen(true);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && pending) return;
    if (!nextOpen) setError("");
    setEditorOpen(nextOpen);
  }

  async function update(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!contextReady || loading || pending) return;
    const token = requests.current.issue(contextKey);
    let saved = false;
    try {
      const validatedProject = stableIdentifier(project, t("common.fields.project"), 128);
      const validatedNamespace = stableIdentifier(namespace, t("common.fields.namespace"), 64);
      if (content.length < 1 || content.length > 1_048_576) throw new UserFacingError(t("checkpoint.contentValidation"));
      if (summary.length > 500) throw new UserFacingError(t("checkpoint.summaryValidation"));
      const validatedOperationId = operationIdFromInput(operationId, true)!;
      setPending(true);
      onPendingChange(true);
      await api.memoryUpdateLast({
        project: validatedProject,
        namespace: validatedNamespace,
        content,
        ...(summary.length ? { summary } : {}),
        expected_revision: checkpointExpectedRevision(currentCheckpoint?.revision),
        operation_id: validatedOperationId,
      });
      void refreshProjectDirectory();
      const result = await api.memoryGetLast({ project: validatedProject, namespace: validatedNamespace });
      const returnedSummary = await checkpointSummary(result.record?.okfMarkdown);
      if (!requests.current.isCurrent(token)) return;
      setCheckpoint(result.record);
      setContent(result.record?.content ?? content);
      setSummary(returnedSummary ?? "");
      setCurrentSummary(returnedSummary ?? "");
      setOperationId(makeOperationId("checkpoint-update"));
      setCommittedContextKey(contextKey);
      notify(t("checkpoint.updated"));
      saved = true;
    } catch (cause) {
      if (!requests.current.isCurrent(token)) return;
      handleApiError(cause);
      setError(errorMessage(cause));
    } finally {
      if (requests.current.isCurrent(token)) {
        setPending(false);
        onPendingChange(false);
        if (saved) setEditorOpen(false);
      }
    }
  }

  return (
    <>
      <CardFrame className="min-w-0">
        <Card className="min-w-0 rounded-b-none!">
          <CardHeader className="min-w-0 max-sm:grid-cols-1!">
            <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
              {t("checkpoint.title")}
              {currentCheckpoint && <Badge variant="outline">{t("checkpoint.revision", { count: currentCheckpoint.revision })}</Badge>}
            </CardTitle>
            <CardDescription className="min-w-0">{t("checkpoint.description")}</CardDescription>
            <CardAction className="min-w-0 flex-wrap gap-2 max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:mt-2 max-sm:w-full max-sm:justify-self-stretch">
              <Button aria-label={t("checkpoint.refresh")} disabled={pending} loading={loading || !contextReady} onClick={() => void load()} size="icon" variant="outline">
                <RefreshCw aria-hidden="true" />
              </Button>
              <Button disabled={!canEdit || pending} onClick={openEditor}>
                <Pencil aria-hidden="true" />{t(currentCheckpoint ? "memories.detail.revise" : "checkpoint.save")}
              </Button>
            </CardAction>
          </CardHeader>
          <CardPanel>
            {loading || !contextReady ? <CheckpointSkeleton /> : loadFailed ? <ErrorAlert message={error} onRetry={() => void load()} /> : currentCheckpoint ? (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{t("checkpoint.currentSummary")}</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{currentSummary || t("checkpoint.noSummary")}</p>
                  </div>
                  <Badge variant="secondary">{currentCheckpoint.kind || t("checkpoint.defaultKind")}</Badge>
                </div>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground">{t("checkpoint.content")}</p>
                  <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-sm leading-6 text-foreground">{currentCheckpoint.content}</p>
                </div>
              </div>
            ) : <EmptyState description={t("checkpoint.emptyDescription")} icon={<Flag aria-hidden="true" />} size="standard" title={t("checkpoint.emptyTitle")} />}
          </CardPanel>
        </Card>
        <CardFrameFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">{t("dashboard.context.title")}</p>
            <p className="mt-1">{t("dashboard.context.description")}</p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono">
              <span>{t("common.fields.project")}: {project || "—"}</span>
              <span>{t("common.fields.namespace")}: {namespace || "—"}</span>
            </p>
          </div>
          <Button className="shrink-0 self-start sm:self-center" render={<Link state={{ backgroundLocation: location }} to="/settings" />} size="sm" variant="ghost">
            <Settings2 aria-hidden="true" />{t("shell.navigation.settings")}
          </Button>
        </CardFrameFooter>
      </CardFrame>

      <CheckpointEditorDialog
        content={content}
        error={error}
        namespace={namespace}
        onContentChange={setContent}
        onOpenChange={handleOpenChange}
        onOperationIdChange={setOperationId}
        onSubmit={update}
        onSummaryChange={setSummary}
        open={editorOpen}
        operationId={operationId}
        pending={pending}
        project={project}
        summary={summary}
      />
    </>
  );
}
