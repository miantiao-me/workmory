import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MemoryListItem } from "../../../server/domain/memory";
import { StatusBadge } from "../../components/common";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { TableCell, TableRow } from "../../components/ui/table";
import { formatDate } from "../../lib/presentation";

function TagBadges({ tags }: { tags: string[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleTags = expanded ? tags : tags.slice(0, 2);
  const remaining = tags.length - visibleTags.length;

  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {visibleTags.map((tag) => (
        <Badge className="max-w-32 overflow-hidden" key={tag} variant="outline">
          <span className="truncate">{tag}</span>
        </Badge>
      ))}
      {remaining > 0 && (
        <Badge
          aria-label={`${t("memories.tags")}: +${remaining}`}
          className="tabular-nums"
          onClick={() => setExpanded(true)}
          render={<button type="button" />}
          variant="secondary"
        >
          +{remaining}
        </Badge>
      )}
    </div>
  );
}

export function MemoryListRow({
  record,
  score,
  onOpen,
}: {
  record: MemoryListItem;
  score?: number;
  onOpen: (key: string) => void;
}) {
  const { t } = useTranslation();
  const preview = record.snippet || t("memories.noPreview");

  return (
    <TableRow>
      <TableCell className="min-w-0 whitespace-normal">
        <Button
          className="h-auto min-h-0 max-w-full justify-start p-0 font-mono text-sm"
          onClick={() => onOpen(record.key)}
          variant="link"
        >
          <span className="truncate">{record.key}</span>
        </Button>
        <p className="line-clamp-1 text-muted-foreground text-sm leading-5">
          {preview}
        </p>
      </TableCell>
      <TableCell>
        <StatusBadge value={record.status} />
      </TableCell>
      <TableCell className="whitespace-normal text-right text-muted-foreground text-xs leading-5">
        {formatDate(record.updatedAt || record.createdAt)}
      </TableCell>
      <TableCell className="min-w-0 whitespace-normal">
        <div className="flex min-w-0 flex-col items-start gap-1">
          {record.kind && (
            <Badge className="max-w-full overflow-hidden" variant="secondary">
              <span className="truncate">{record.kind}</span>
            </Badge>
          )}
          <TagBadges tags={record.tags} />
          {!record.kind && !record.tags.length && (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      </TableCell>
      <TableCell className="font-mono tabular-nums">
        r{record.revision}
      </TableCell>
      <TableCell className="font-mono tabular-nums">
        {score?.toFixed(3) ?? "—"}
      </TableCell>
    </TableRow>
  );
}
