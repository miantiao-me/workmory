import { Copy, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MemoryRecord } from "../../../server/domain/memory";
import { DetailItem, DetailList, StatusBadge } from "../common";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
import { Skeleton } from "../ui/skeleton";
import { formatDate } from "../../lib/presentation";
import { ConfirmDialog } from "./confirm-dialog";

function MemoryDetailSkeleton() {
  const { t } = useTranslation();

  return (
    <div aria-busy="true" aria-live="polite" className="grid gap-4" role="status">
      <span className="sr-only">{t("common.loading")}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Skeleton aria-hidden="true" className="h-5 min-w-40 flex-1" />
        <Skeleton aria-hidden="true" className="h-5 w-20 rounded-full" />
        <Skeleton aria-hidden="true" className="h-5 w-16 rounded-full" />
      </div>
      <Tabs className="gap-3" defaultValue="content">
        <TabsList size="sm">
          <TabsTab disabled value="content"><Skeleton aria-hidden="true" className="h-3 w-14" /></TabsTab>
          <TabsTab disabled value="okf"><Skeleton aria-hidden="true" className="h-3 w-14" /></TabsTab>
        </TabsList>
        <TabsPanel className="grid gap-4" value="content">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="min-w-0" key={index}>
                <Skeleton aria-hidden="true" className="h-4 w-20" />
                <Skeleton aria-hidden="true" className="mt-1 h-5 w-full max-w-48" />
              </div>
            ))}
          </div>
          <Card>
            <CardPanel className="grid gap-2 p-3">
              <Skeleton aria-hidden="true" className="h-4 w-full" />
              <Skeleton aria-hidden="true" className="h-4 w-11/12" />
              <Skeleton aria-hidden="true" className="h-4 w-3/4" />
            </CardPanel>
          </Card>
        </TabsPanel>
      </Tabs>
    </div>
  );
}

export function MemoryDetailDialog({ detail, loading, open, onOpenChange, onCopy, onDelete, onEdit, readOnly = false, deleting = false }: {
  detail?: MemoryRecord;
  loading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopy: (key: string) => void;
  onDelete?: (record: MemoryRecord) => void;
  onEdit?: (record: MemoryRecord) => void;
  readOnly?: boolean;
  deleting?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("memories.detail.title")}</DialogTitle>
          <DialogDescription>{t("memories.detail.description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-4">
          {loading ? <MemoryDetailSkeleton /> : detail && (
            <>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <code className="min-w-0 break-all font-mono text-sm font-semibold">{detail.key}</code>
                  <Button aria-label={t("memories.detail.copyKey")} className="shrink-0" onClick={() => onCopy(detail.key)} size="icon-sm" variant="ghost"><Copy aria-hidden="true" /></Button>
                </div>
                <Badge variant="outline">{t("memories.detail.revision", { revision: String(detail.revision) })}</Badge>
                <StatusBadge value={detail.status} />
              </div>
              <Tabs className="gap-3" defaultValue="content">
                <TabsList className="max-w-full overflow-x-auto" size="sm">
                  <TabsTab value="content">{t("memories.detail.tabs.content")}</TabsTab>
                  <TabsTab value="okf">{t("memories.detail.tabs.okf")}</TabsTab>
                </TabsList>
                <TabsPanel className="grid gap-4" value="content">
                  <DetailList className="gap-y-4">
                    <DetailItem label={t("common.fields.project")} mono value={detail.project} />
                    <DetailItem label={t("common.fields.namespace")} mono value={detail.namespace} />
                    <DetailItem label={t("memories.detail.updated")} value={formatDate(detail.updatedAt)} />
                    <DetailItem label={t("memories.detail.kind")} value={detail.kind || "—"} />
                  </DetailList>
                  {detail.content
                    ? <Card><CardPanel className="p-0"><ScrollArea className="h-64" clampContentMinWidth={false} overscrollContain scrollFade scrollbarGutter><div className="whitespace-pre-wrap break-words p-3 text-sm leading-6">{detail.content}</div></ScrollArea></CardPanel></Card>
                    : <p className="py-8 text-center text-sm text-muted-foreground">{t("memories.detail.noContent")}</p>}
                  <DetailList className="gap-y-4 border-t pt-4">
                    <DetailItem label={t("memories.detail.created")} value={formatDate(detail.createdAt)} />
                    <DetailItem
                      label={t("memories.detail.tags")}
                      value={detail.tags.length
                        ? <span className="flex min-w-0 flex-wrap gap-1.5">{detail.tags.map((tag) => <Badge className="h-auto max-w-full whitespace-normal break-all py-1" key={tag} variant="outline">{tag}</Badge>)}</span>
                        : <span className="text-muted-foreground">{t("memories.detail.noTags")}</span>}
                    />
                    <DetailItem
                      className="sm:col-span-2"
                      label={t("memories.detail.attachmentIds")}
                      value={detail.attachmentIds?.length
                        ? <span className="flex min-w-0 flex-wrap gap-2">{detail.attachmentIds.map((id) => <Badge className="h-auto max-w-full whitespace-normal break-all py-1" key={id} variant="secondary"><code>{id}</code></Badge>)}</span>
                        : <span className="text-muted-foreground">{t("memories.detail.noAttachments")}</span>}
                    />
                  </DetailList>
                </TabsPanel>
                <TabsPanel value="okf">
                  {detail.okfMarkdown
                    ? <Card><CardPanel className="p-0"><ScrollArea className="h-64" clampContentMinWidth={false} overscrollContain scrollFade scrollbarGutter><pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">{detail.okfMarkdown}</pre></ScrollArea></CardPanel></Card>
                    : <p className="py-8 text-center text-sm text-muted-foreground">{t("memories.detail.noOkf")}</p>}
                </TabsPanel>
              </Tabs>
            </>
          )}
        </DialogPanel>
        {!readOnly && !loading && detail && (onDelete || onEdit) && (
          <DialogFooter className="sm:justify-between">
            {onDelete && <ConfirmDialog
              confirmLabel={t("memories.detail.deleteConfirm")}
              description={t("memories.detail.deleteDescription", { key: detail.key })}
              destructive
              onConfirm={() => onDelete(detail)}
              title={t("memories.detail.deleteTitle")}
              trigger={<Button className="max-sm:w-full" disabled={deleting} loading={deleting} variant="destructive-outline"><Trash2 aria-hidden="true" />{t("memories.detail.delete")}</Button>}
            />}
            {onEdit && <Button disabled={deleting} onClick={() => onEdit(detail)}><Pencil aria-hidden="true" />{t("memories.detail.revise")}</Button>}
          </DialogFooter>
        )}
      </DialogPopup>
    </Dialog>
  );
}
