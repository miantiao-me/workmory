import { useTranslation } from "react-i18next";
import { Badge } from "../ui/badge";

const statusKeys = {
  active: "common.status.active",
  complete: "common.status.complete",
  deleted: "common.status.deleted",
  deleting: "common.status.deleting",
  failed: "common.status.failed",
  pending: "common.status.pending",
  processing: "common.status.processing",
  ready: "common.status.ready",
  review: "common.status.review",
  retrying: "common.status.retrying",
} as const;

export function StatusBadge({ value }: { value?: string }) {
  const { t } = useTranslation();
  const normalized = value?.toLowerCase();
  const labelKey = normalized ? statusKeys[normalized as keyof typeof statusKeys] : undefined;
  const variant = normalized === "ready" || normalized === "active" || normalized === "complete"
    ? "success"
    : normalized === "failed" || normalized === "deleted"
      ? "error"
      : normalized === "processing" || normalized === "deleting"
        ? "warning"
        : "outline";

  return (
    <Badge title={labelKey ? value : undefined} variant={variant}>
      {labelKey ? t(labelKey) : value || t("common.status.unmarked")}
    </Badge>
  );
}

export function statusLabelKey(value: string): (typeof statusKeys)[keyof typeof statusKeys] | undefined {
  const normalized = value.toLowerCase();
  return normalized ? statusKeys[normalized as keyof typeof statusKeys] : undefined;
}
