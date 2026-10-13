import { File } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState, StatusBadge } from "../../components/common";
import {
  ListItem,
  ListItemBadges,
  ListItemContent,
  ListItemDescription,
  ListItemHeader,
  ListItemSpanningTrigger,
  ListItemTitle,
} from "../../components/list-item";
import { Card, CardPanel } from "../../components/ui/card";
import { formatDate } from "../../lib/presentation";
import type { RecentAttachmentItem } from "./use-attachment-scope";

export function RecentAttachmentList({ items, busy, onSelect }: {
  items: RecentAttachmentItem[];
  busy: boolean;
  onSelect: (item: RecentAttachmentItem) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      {items.length ? (
        <CardPanel aria-label={t("attachments.recent")} className="p-0" role="list">
          {items.map((item) => (
            <ListItem key={item.id} role="listitem">
              <ListItemContent className="min-w-0">
                <ListItemHeader className="min-w-0">
                  <ListItemTitle className="min-w-0 max-w-full">
                    <ListItemSpanningTrigger
                      className="block min-w-0 max-w-full truncate text-left disabled:cursor-not-allowed"
                      onClick={() => onSelect(item)}
                      render={<button disabled={busy} type="button" />}
                      title={item.filename}
                    >
                      {item.filename}
                    </ListItemSpanningTrigger>
                  </ListItemTitle>
                  <ListItemDescription className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs">
                    <span className="max-w-full truncate font-mono" title={item.id}>{item.id}</span>
                    <span aria-hidden="true">·</span>
                    <span className="max-w-full truncate" title={item.project}>{item.project}</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0">{formatDate(item.createdAt)}</span>
                  </ListItemDescription>
                </ListItemHeader>
              </ListItemContent>
              <ListItemBadges className="shrink-0"><StatusBadge value={item.status} /></ListItemBadges>
            </ListItem>
          ))}
        </CardPanel>
      ) : (
        <CardPanel className="p-0">
          <EmptyState description={t("attachments.noRecordsDescription")} icon={<File aria-hidden="true" />} title={t("attachments.noRecords")} />
        </CardPanel>
      )}
    </Card>
  );
}
