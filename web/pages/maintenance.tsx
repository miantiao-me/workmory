import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, AlertTriangle, RefreshCw, RotateCcw, Wrench } from "lucide-react";
import { AppHeader, AppHeaderActions, AppHeaderContent, AppHeaderDescription } from "../components/app/app-header";
import { ErrorAlert } from "../components/common";
import { ConfirmDialog } from "@/components/dialogs";
import { ListItem, ListItemActions, ListItemContent, ListItemDescription, ListItemHeader, ListItemTitle } from "../components/list-item";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardFrame, CardFrameDescription, CardFrameHeader, CardFrameTitle, CardPanel } from "../components/ui/card";
import { ScrollArea } from "../components/ui/scroll-area";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { useApp } from "../context/app-context";
import { useMaintenanceStatus } from "../hooks/use-maintenance-status";
import type { MaintenanceProcessResult, MaintenanceReindexResult, MaintenanceStatus } from "../lib/api/types";
import { errorMessage } from "../lib/presentation";

type MetricTone = "default" | "warning" | "error";
type Metric = { label: string; value: number; tone: MetricTone };

function MaintenanceStatusSkeleton() {
  const { t } = useTranslation();

  return (
    <CardFrame aria-busy="true" aria-live="polite" className="shrink-0" role="status">
      <span className="sr-only">{t("common.loading")}</span>
      <CardFrameHeader>
        <Skeleton aria-hidden="true" className="h-5 w-40" />
        <Skeleton aria-hidden="true" className="h-4 w-full max-w-80" />
      </CardFrameHeader>
      <Table render={<ScrollArea className="min-w-0" overscrollContain scrollbarGutter />} variant="card">
        <TableHeader>
          <TableRow>
            <TableHead><Skeleton aria-hidden="true" className="h-4 w-20" /></TableHead>
            <TableHead><Skeleton aria-hidden="true" className="h-4 w-16" /></TableHead>
            <TableHead><Skeleton aria-hidden="true" className="ml-auto h-4 w-14" /></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 10 }, (_, metric) => (
            <TableRow key={metric}>
              <TableCell><Skeleton aria-hidden="true" className="h-4 w-28" /></TableCell>
              <TableCell><Skeleton aria-hidden="true" className="h-4 w-24" /></TableCell>
              <TableCell><Skeleton aria-hidden="true" className="ml-auto h-4 w-8" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardFrame>
  );
}

export function MaintenancePage() {
  const { t } = useTranslation();
  const { api, handleApiError, notify } = useApp();
  const { status, loading: statusLoading, error: statusError, load } = useMaintenanceStatus();
  const [lastResult, setLastResult] = useState<MaintenanceProcessResult | MaintenanceReindexResult>();
  const [actionPending, setActionPending] = useState<"process" | "reindex" | null>(null);
  const [error, setError] = useState("");
  const pending = statusLoading || actionPending !== null;

  async function run(action: "process" | "reindex") {
    if (pending) return;
    setActionPending(action);
    setError("");
    try {
      const result = action === "process" ? await api.maintenanceProcess() : await api.maintenanceReindex();
      setLastResult(result);
      notify(action === "process" ? t("maintenance.processed") : t("maintenance.reindexed"));
      await load();
    } catch (cause) {
      handleApiError(cause);
      setError(errorMessage(cause));
    } finally {
      setActionPending(null);
    }
  }

  return (
    <>
      <AppHeader>
        <AppHeaderContent title={t("maintenance.title")}>
          <AppHeaderDescription>{t("maintenance.description")}</AppHeaderDescription>
        </AppHeaderContent>
        <AppHeaderActions>
          <Button disabled={pending} loading={statusLoading} onClick={() => void load()} variant="outline">
            <RefreshCw aria-hidden="true" />
            {t("maintenance.refresh")}
          </Button>
        </AppHeaderActions>
      </AppHeader>

      <div className="flex flex-col gap-4">
        <Alert className="shrink-0" variant="info">
          <Activity aria-hidden="true" />
          <AlertTitle>{t("maintenance.aggregateTitle")}</AlertTitle>
          <AlertDescription>{t("maintenance.aggregateDescription")}</AlertDescription>
        </Alert>

        {statusLoading && !status ? (
          <MaintenanceStatusSkeleton />
        ) : statusError && !status ? (
          <ErrorAlert message={statusError} onRetry={() => void load()} />
        ) : status ? (
          <>
            <MaintenanceStatusFrame status={status} />

            {(error || statusError) && <div className="shrink-0"><ErrorAlert message={error || statusError} /></div>}

            <CardFrame className="shrink-0" aria-labelledby="maintenance-actions-title">
              <CardFrameHeader>
                <CardFrameTitle id="maintenance-actions-title">{t("maintenance.actionsTitle")}</CardFrameTitle>
                <CardFrameDescription>{t("maintenance.actionsDescription")}</CardFrameDescription>
              </CardFrameHeader>

              <Card>
                <CardPanel className="p-0">
                  <ListItem className="max-sm:[&>div]:flex-wrap">
                    <ListItemContent>
                      <ListItemHeader>
                        <ListItemTitle>{t("maintenance.process")}</ListItemTitle>
                        <ListItemDescription>{t("maintenance.processDescription")}</ListItemDescription>
                      </ListItemHeader>
                    </ListItemContent>
                    <ListItemActions className="max-sm:w-full max-sm:justify-end">
                      <ConfirmDialog
                        confirmLabel={t("maintenance.processConfirm")}
                        description={t("maintenance.processDescription")}
                        onConfirm={() => void run("process")}
                        title={t("maintenance.processTitle")}
                        trigger={(
                          <Button disabled={pending} loading={actionPending === "process"}>
                            <Wrench aria-hidden="true" />
                            {t("maintenance.process")}
                          </Button>
                        )}
                      />
                    </ListItemActions>
                  </ListItem>

                  <ListItem className="max-sm:[&>div]:flex-wrap">
                    <ListItemContent>
                      <ListItemHeader>
                        <ListItemTitle>{t("maintenance.reindex")}</ListItemTitle>
                        <ListItemDescription className="flex items-start gap-2">
                          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
                          <span>{t("maintenance.reindexDescription", { count: status.reindex.candidates })}</span>
                        </ListItemDescription>
                      </ListItemHeader>
                    </ListItemContent>
                    <ListItemActions className="max-sm:w-full max-sm:justify-end">
                      <ConfirmDialog
                        confirmLabel={t("maintenance.reindexConfirm")}
                        description={t("maintenance.reindexDescription", { count: status.reindex.candidates })}
                        onConfirm={() => void run("reindex")}
                        title={t("maintenance.reindexTitle")}
                        trigger={(
                          <Button disabled={pending} loading={actionPending === "reindex"} variant="outline">
                            <RotateCcw aria-hidden="true" />
                            {t("maintenance.reindex")}
                          </Button>
                        )}
                      />
                    </ListItemActions>
                  </ListItem>
                </CardPanel>
              </Card>
            </CardFrame>

            {lastResult && (
              <CardFrame className="shrink-0" aria-labelledby="maintenance-last-result">
                <CardFrameHeader>
                  <CardFrameTitle id="maintenance-last-result">{t("maintenance.lastResult")}</CardFrameTitle>
                  <CardFrameDescription>{t("maintenance.lastResultDescription")}</CardFrameDescription>
                </CardFrameHeader>
                <Card>
                  <CardPanel>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 [overflow-wrap:anywhere]"><code>{JSON.stringify(lastResult, null, 2)}</code></pre>
                  </CardPanel>
                </Card>
              </CardFrame>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}

function MaintenanceStatusFrame({ status }: { status: MaintenanceStatus }) {
  const { t } = useTranslation();
  const groups: { label: string; metrics: Metric[] }[] = [
    {
      label: t("maintenance.indexQueue"),
      metrics: [
        { label: t("maintenance.pending"), value: status.outbox.pending, tone: "default" },
        { label: t("maintenance.due"), value: status.outbox.due, tone: status.outbox.due ? "warning" : "default" },
        { label: t("maintenance.processing"), value: status.outbox.processing, tone: "default" },
        { label: t("maintenance.stale"), value: status.outbox.stale, tone: status.outbox.stale ? "error" : "default" },
        { label: t("maintenance.retrying"), value: status.outbox.retrying, tone: status.outbox.retrying ? "warning" : "default" },
      ],
    },
    {
      label: t("maintenance.cleanupTitle"),
      metrics: [
        { label: t("maintenance.processing"), value: status.attachments.processing, tone: "default" },
        { label: t("maintenance.timedOut"), value: status.attachments.staleProcessing, tone: status.attachments.staleProcessing ? "error" : "default" },
        { label: t("maintenance.failed"), value: status.attachments.failed, tone: status.attachments.failed ? "error" : "default" },
        { label: t("maintenance.deleting"), value: status.attachments.deleting, tone: status.attachments.deleting ? "warning" : "default" },
      ],
    },
    {
      label: t("maintenance.reindexGroup"),
      metrics: [
        { label: t("maintenance.candidates"), value: status.reindex.candidates, tone: "default" },
      ],
    },
  ];

  return (
    <CardFrame className="shrink-0" aria-labelledby="maintenance-status-title">
      <CardFrameHeader>
        <CardFrameTitle id="maintenance-status-title">{t("maintenance.metricsTitle")}</CardFrameTitle>
        <CardFrameDescription>{t("maintenance.metricsDescription")}</CardFrameDescription>
      </CardFrameHeader>
      <Table aria-label={t("maintenance.queueAria")} render={<ScrollArea className="min-w-0" overscrollContain scrollbarGutter />} variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>{t("maintenance.group")}</TableHead>
            <TableHead>{t("maintenance.metric")}</TableHead>
            <TableHead className="text-right">{t("maintenance.count")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.flatMap((group) => group.metrics.map((metric) => (
            <TableRow key={`${group.label}-${metric.label}`}>
              <TableCell className="whitespace-normal">{group.label}</TableCell>
              <TableCell className="whitespace-normal">
                {metric.tone === "default" ? metric.label : (
                  <Badge variant={metric.tone === "error" ? "error" : "warning"}>
                    <AlertTriangle aria-hidden="true" />
                    {metric.label}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{metric.value}</TableCell>
            </TableRow>
          )))}
        </TableBody>
      </Table>
    </CardFrame>
  );
}
