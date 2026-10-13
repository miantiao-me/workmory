import { useState } from "react";
import { AlertTriangle, Gauge, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppHeader, AppHeaderActions, AppHeaderContent, AppHeaderDescription } from "../components/app/app-header";
import { ErrorAlert } from "../components/common";
import { ListItem, ListItemActions, ListItemContent, ListItemDescription, ListItemHeader, ListItemTitle } from "../components/list-item";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardFrame, CardFrameAction, CardFrameDescription, CardFrameHeader, CardFrameTitle, CardPanel } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { useApp } from "../context/app-context";
import { useMaintenanceStatus } from "../hooks/use-maintenance-status";
import { CheckpointCard } from "./checkpoint-card";

function DashboardMaintenanceSkeleton() {
  const { t } = useTranslation();

  return (
    <CardFrame aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">{t("common.loading")}</span>
      <CardFrameHeader>
        <CardFrameTitle className="flex flex-wrap items-center gap-2">
          <Skeleton aria-hidden="true" className="h-5 w-40" />
          <Skeleton aria-hidden="true" className="h-5 w-16 rounded-full" />
        </CardFrameTitle>
        <CardFrameDescription>
          <Skeleton aria-hidden="true" className="h-5 w-64 max-w-full" />
        </CardFrameDescription>
      </CardFrameHeader>
      <Card>
        <CardPanel className="p-0">
          {Array.from({ length: 4 }, (_, index) => (
            <ListItem key={index}>
              <ListItemContent>
                <ListItemHeader>
                  <Skeleton aria-hidden="true" className="h-5 w-full max-w-40" />
                  <Skeleton aria-hidden="true" className="h-5 w-full max-w-56" />
                </ListItemHeader>
              </ListItemContent>
              <ListItemActions>
                <Skeleton aria-hidden="true" className="h-5 w-8" />
              </ListItemActions>
            </ListItem>
          ))}
        </CardPanel>
      </Card>
    </CardFrame>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { defaultProject, defaultNamespace } = useApp();
  const { status, loading, error, load } = useMaintenanceStatus();
  const [checkpointPending, setCheckpointPending] = useState(false);

  const needsMaintenance = Boolean(status && (
    status.outbox.due
    || status.outbox.stale
    || status.attachments.staleProcessing
    || status.attachments.failed
    || status.attachments.deleting
  ));
  const hasMaintenanceFailure = Boolean(status?.attachments.failed);

  return (
    <>
      <AppHeader>
        <AppHeaderContent title={t("dashboard.title")}>
          <AppHeaderDescription>{t("dashboard.description")}</AppHeaderDescription>
        </AppHeaderContent>
        <AppHeaderActions>
          <Button loading={loading} onClick={() => void load()} variant="outline">
            <RefreshCw aria-hidden="true" />{t("dashboard.refresh")}
          </Button>
        </AppHeaderActions>
      </AppHeader>

      <div className="grid min-w-0 gap-4">
        {error && <ErrorAlert message={error} onRetry={() => void load()} />}
        {status && hasMaintenanceFailure && (
          <Alert variant="error">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>{t("maintenance.actionsTitle")}</AlertTitle>
            <AlertDescription>{t("maintenance.processDescription")}</AlertDescription>
            <AlertAction>
              <Button render={<Link to="/maintenance" />} size="sm" variant="outline">
                <Gauge aria-hidden="true" />{t("shell.navigation.maintenance")}
              </Button>
            </AlertAction>
          </Alert>
        )}

        <section className="min-w-0" aria-busy={checkpointPending} aria-label={t("dashboard.checkpointTitle")}>
          <CheckpointCard namespace={defaultNamespace} onPendingChange={setCheckpointPending} project={defaultProject} />
        </section>

        {loading && !status ? <DashboardMaintenanceSkeleton /> : status && (
          <CardFrame aria-labelledby="dashboard-maintenance-title">
            <CardFrameHeader>
              <CardFrameTitle className="flex flex-wrap items-center gap-2" id="dashboard-maintenance-title">
                {t("dashboard.maintenanceSummary")}
                <Badge variant={needsMaintenance ? "warning" : "success"}>
                  {t(needsMaintenance ? "common.status.pending" : "common.status.ready")}
                </Badge>
              </CardFrameTitle>
              <CardFrameDescription>{t("maintenance.description")}</CardFrameDescription>
              {needsMaintenance && (
                <CardFrameAction>
                  <Button render={<Link to="/maintenance" />} size="sm" variant="outline">
                    <Gauge aria-hidden="true" />{t("shell.navigation.maintenance")}
                  </Button>
                </CardFrameAction>
              )}
            </CardFrameHeader>

            <Card>
              <CardPanel className="p-0">
                <ListItem>
                  <ListItemContent>
                    <ListItemHeader>
                      <ListItemTitle>{t("dashboard.stats.pending")}</ListItemTitle>
                      <ListItemDescription>{t("dashboard.stats.due", { count: status.outbox.due })}</ListItemDescription>
                    </ListItemHeader>
                  </ListItemContent>
                  <ListItemActions><span className="font-heading text-sm font-semibold tabular-nums">{status.outbox.pending}</span></ListItemActions>
                </ListItem>
                <ListItem>
                  <ListItemContent>
                    <ListItemHeader>
                      <ListItemTitle>{t("dashboard.stats.processing")}</ListItemTitle>
                      <ListItemDescription>{t("dashboard.stats.retrying", { count: status.outbox.retrying })}</ListItemDescription>
                    </ListItemHeader>
                  </ListItemContent>
                  <ListItemActions><span className="font-heading text-sm font-semibold tabular-nums">{status.outbox.processing}</span></ListItemActions>
                </ListItem>
                <ListItem>
                  <ListItemContent>
                    <ListItemHeader>
                      <ListItemTitle>{t("dashboard.stats.attachmentErrors")}</ListItemTitle>
                      <ListItemDescription>{t("dashboard.stats.timedOut", { count: status.attachments.staleProcessing })}</ListItemDescription>
                    </ListItemHeader>
                  </ListItemContent>
                  <ListItemActions><span className="font-heading text-sm font-semibold tabular-nums">{status.attachments.failed}</span></ListItemActions>
                </ListItem>
                <ListItem>
                  <ListItemContent>
                    <ListItemHeader>
                      <ListItemTitle>{t("dashboard.stats.rebuildable")}</ListItemTitle>
                      <ListItemDescription>{t("dashboard.stats.rebuildableNote")}</ListItemDescription>
                    </ListItemHeader>
                  </ListItemContent>
                  <ListItemActions><span className="font-heading text-sm font-semibold tabular-nums">{status.reindex.candidates}</span></ListItemActions>
                </ListItem>
              </CardPanel>
            </Card>
          </CardFrame>
        )}
      </div>
    </>
  );
}
