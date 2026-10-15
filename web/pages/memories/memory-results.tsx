import { ChevronLeft, ChevronRight, Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SearchResult } from "../../../server/domain/memory";
import { EmptyState } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Card, CardFooter } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { MemoryListRow } from "./memory-list-row";
import type { MemoryRow } from "./use-memory-results";

const COLUMN_WIDTHS = ["w-32 sm:w-56", "w-16", "w-20", "w-40", "w-12", "w-12"];
const NUMERIC_COLUMNS = "[&_tbody_td:nth-child(5)]:text-right [&_tbody_td:nth-child(6)]:text-right";

function MemoryTableSkeleton() {
  const { t } = useTranslation();

  return (
    <div aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">{t("common.loading")}</span>
      <Table className={NUMERIC_COLUMNS} variant="card">
        <TableHeader>
          <TableRow>
            <TableHead><Skeleton aria-hidden="true" className="h-4 w-16" /></TableHead>
            <TableHead><Skeleton aria-hidden="true" className="h-4 w-14" /></TableHead>
            <TableHead><Skeleton aria-hidden="true" className="ml-auto h-4 w-16" /></TableHead>
            <TableHead><Skeleton aria-hidden="true" className="h-4 w-24" /></TableHead>
            <TableHead><Skeleton aria-hidden="true" className="ml-auto h-4 w-14" /></TableHead>
            <TableHead><Skeleton aria-hidden="true" className="ml-auto h-4 w-12" /></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 6 }, (_, row) => (
            <TableRow key={row}>
              {COLUMN_WIDTHS.map((width, column) => (
                <TableCell key={column}>
                  <Skeleton aria-hidden="true" className={`h-4 ${width}`} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function MemoryResults({ rows, loading, hasError = false, isSearching, responseBudget, cursorHistory, nextCursor, onOpen, onOpenNew, onPreviousPage, onNextPage }: {
  rows: MemoryRow[];
  responseBudget?: SearchResult["responseBudget"];
  loading: boolean;
  hasError?: boolean;
  isSearching: boolean;
  cursorHistory: unknown[];
  nextCursor?: string;
  onOpen: (key: string) => void;
  onOpenNew: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  const { t } = useTranslation();
  const budgetExceeded = !hasError && isSearching && Boolean(responseBudget?.omittedItems);
  const emptyTitle = budgetExceeded
    ? t("memories.budget.title")
    : t(isSearching ? "memories.empty.noResults" : "memories.empty.title");
  const emptyDescription = budgetExceeded
    ? t("memories.budget.description")
    : t(isSearching ? "memories.empty.searchDescription" : "memories.empty.description");
  const emptyAction = budgetExceeded ? undefined : <Button onClick={onOpenNew}>{t("memories.empty.first")}</Button>;

  if (hasError && !rows.length) return null;

  return (
    <Card className="w-full min-w-0">
      {!loading && budgetExceeded && rows.length > 0 && <p className="px-6 pt-4 text-muted-foreground text-sm" role="status">{t("memories.budget.omitted", { count: responseBudget?.omittedItems ?? 0 })}</p>}
      {loading ? <MemoryTableSkeleton /> : !rows.length ? (
        <EmptyState
          action={emptyAction}
          description={emptyDescription}
          icon={<Database aria-hidden="true" />}
          title={emptyTitle}
        />
      ) : (
        <Table className={NUMERIC_COLUMNS} variant="card">
          <TableHeader>
            <TableRow>
              <TableHead>{t("memories.table.key")}</TableHead>
              <TableHead>{t("memories.table.status")}</TableHead>
              <TableHead className="text-right">{t("memories.table.updated")}</TableHead>
              <TableHead>{t("memories.table.typeAndTags")}</TableHead>
              <TableHead className="text-right">{t("memories.table.revision")}</TableHead>
              <TableHead className="text-right">{t("memories.table.score")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ record, score }) => (
              <MemoryListRow key={`${record.key}-${record.revision}`} onOpen={onOpen} record={record} score={score} />
            ))}
          </TableBody>
        </Table>
      )}

      {!isSearching && (
        <CardFooter className="flex items-center justify-between gap-2 border-t">
          <Button disabled={loading || !cursorHistory.length} onClick={onPreviousPage} size="sm" variant="outline">
            <ChevronLeft aria-hidden="true" />{t("memories.pagination.previous")}
          </Button>
          <Button disabled={loading || !nextCursor} onClick={onNextPage} size="sm" variant="outline">
            {t("memories.pagination.next")}<ChevronRight aria-hidden="true" />
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
