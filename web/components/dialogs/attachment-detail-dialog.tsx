import { Copy, Download, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AttachmentMetadata } from "../../lib/api/types";
import { DetailItem, DetailList, ErrorAlert, StatusBadge } from "../common";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { formatBytes, formatDate } from "../../lib/presentation";
import { ConfirmDialog } from "./confirm-dialog";

export function AttachmentDetailDialog({ item, error, open, pending, onOpenChange, onCopy, onDownload, onDelete }: {
  item?: AttachmentMetadata;
  error: string;
  open: boolean;
  pending: string | null;
  onOpenChange: (open: boolean) => void;
  onCopy: (value: string) => void;
  onDownload: (kind: "original" | "markdown") => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const busy = pending !== null;

  return (
    <Dialog onOpenChange={(nextOpen) => { if (!nextOpen && busy) return; onOpenChange(nextOpen); }} open={open}>
      <DialogPopup aria-busy={busy} className="sm:max-w-2xl" closeProps={{ disabled: busy }}>
        {item && (
          <>
            <DialogHeader>
              <div className="flex min-w-0 flex-wrap items-center gap-2 pe-8">
                <DialogTitle className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item.filename}</DialogTitle>
                <StatusBadge value={item.status} />
                {item.reused && <Badge variant="info">{t("attachments.detail.reused")}</Badge>}
              </div>
              <DialogDescription>{t("attachments.metadata")}</DialogDescription>
            </DialogHeader>

            <DialogPanel className="grid gap-6">
              {error && <ErrorAlert message={error} />}
              <DetailList className="grid-cols-1 sm:grid-cols-2">
                <DetailItem className="sm:col-span-2" label={t("attachments.attachmentId")} mono value={<span className="flex items-start gap-2"><span className="min-w-0 flex-1 break-all">{item.id}</span><Button aria-label={t("attachments.detail.copyId")} onClick={() => onCopy(item.id)} size="icon-sm" variant="ghost"><Copy aria-hidden="true" /></Button></span>} />
                <DetailItem label={t("common.fields.project")} value={<span className="break-all">{item.project}</span>} />
                <DetailItem label={t("attachments.detail.sourceKind")} value={item.sourceKind} />
                <DetailItem label={t("attachments.detail.detectedMime")} value={item.detectedMime} />
                <DetailItem label={t("attachments.detail.declaredMime")} value={item.declaredMime || "—"} />
                <DetailItem label={t("attachments.detail.originalSize")} value={formatBytes(item.originalSize)} />
                <DetailItem label={t("attachments.detail.markdownSize")} value={formatBytes(item.markdownSize)} />
                <DetailItem label={t("attachments.detail.created")} value={formatDate(item.createdAt)} />
                <DetailItem label={t("attachments.detail.converter")} value={item.converter || "—"} />
                <DetailItem className="sm:col-span-2" label={t("attachments.detail.originalSha")} mono value={item.originalSha256} />
                <DetailItem className="sm:col-span-2" label={t("attachments.detail.markdownSha")} mono value={item.markdownSha256 || "—"} />
                <DetailItem label={t("attachments.detail.errorCode")} mono value={item.errorCode || "—"} />
              </DetailList>
              {item.errorCode && <Alert variant="error"><AlertTitle>{t("attachments.detail.failed")}</AlertTitle><AlertDescription>{item.errorCode}</AlertDescription></Alert>}
            </DialogPanel>

            <DialogFooter className="sm:justify-between">
              <ConfirmDialog confirmLabel={t("attachments.detail.deleteConfirm")} description={t("attachments.detail.deleteDescription")} destructive onConfirm={onDelete} title={t("attachments.detail.deleteTitle")} trigger={<Button className="max-sm:w-full" disabled={busy} loading={pending === "delete"} variant="destructive-outline"><Trash2 aria-hidden="true" />{t("attachments.detail.delete")}</Button>} />
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                <Button disabled={busy || item.status !== "ready"} loading={pending === "original"} onClick={() => onDownload("original")} variant="outline"><Download aria-hidden="true" />{t("attachments.detail.original")}</Button>
                <Button disabled={busy || item.status !== "ready" || item.markdownSize === undefined} loading={pending === "markdown"} onClick={() => onDownload("markdown")} variant="outline"><Download aria-hidden="true" />Markdown</Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}
