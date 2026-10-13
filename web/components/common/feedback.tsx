import type { ReactNode } from "react";
import { AlertCircle, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { ListItem, ListItemContent, ListItemHeader } from "../list-item";

export function LoadingState({ rows = 3 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <Card aria-busy="true" aria-live="polite" data-slot="loading-state" role="status">
      <span className="sr-only">{t("common.loading")}</span>
      <CardPanel className="p-0">
        {Array.from({ length: rows }, (_, index) => (
          <ListItem key={index}>
            <ListItemContent>
              <ListItemHeader>
                <Skeleton aria-hidden="true" className="h-5 w-full max-w-48" />
                <Skeleton aria-hidden="true" className="my-0.5 h-4 w-full max-w-32" />
              </ListItemHeader>
            </ListItemContent>
            <Skeleton aria-hidden="true" className="size-8 rounded-lg" />
          </ListItem>
        ))}
      </CardPanel>
    </Card>
  );
}

export function EmptyState({ title, description, icon = <Server aria-hidden="true" />, action, size = "standard" }: {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  size?: "compact" | "standard";
}) {
  return (
    <Empty data-size={size} data-slot="empty-state">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export function ErrorAlert({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <Alert className={className} data-feedback="error" variant="error">
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{t("common.operationIncomplete")}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      {onRetry && (
        <AlertAction>
          <Button onClick={onRetry} size="sm" variant="outline">
            {t("common.retry")}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}

export function FullPageLoader({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Spinner className="size-5" />
        {label ?? t("common.loading")}
      </div>
    </div>
  );
}
