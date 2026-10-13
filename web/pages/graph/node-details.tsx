import { GitFork, UnfoldVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MemoryGraphNode } from "../../lib/api/types";
import { formatDate } from "../../lib/presentation";
import { EmptyState, StatusBadge } from "../../components/common";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";

export interface NodeRelation {
  key: string;
  direction: "incoming" | "outgoing";
  origin: "link" | "source";
  occurrences: number;
  resolved: boolean;
}

export function NodeDetails({ node, relations, onSelect, onExpand, onOpenMemory, busy, exhausted }: {
  node?: MemoryGraphNode;
  relations: NodeRelation[];
  onSelect: (key: string) => void;
  onExpand: () => void;
  onOpenMemory: () => void;
  busy: boolean;
  exhausted: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4">
      {!node ? (
        <EmptyState description={t("graph.detail.description")} icon={<GitFork aria-hidden="true" />} size="compact" title={t("graph.detail.title")} />
      ) : !node.resolved ? (
        <>
          <div><Badge variant="error">{t("graph.detail.unresolved")}</Badge></div>
          <div><p className="text-xs text-muted-foreground">{t("graph.detail.key")}</p><code className="break-all text-sm">{node.key}</code></div>
          <p className="text-sm text-muted-foreground">{t("graph.detail.unresolvedDescription")}</p>
        </>
      ) : (
        <>
          <div className="grid gap-3 text-sm">
            <div><p className="text-xs text-muted-foreground">{t("graph.detail.key")}</p><code className="break-all">{node.key}</code></div>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-muted-foreground">{t("graph.detail.kind")}</p><p>{node.kind || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">{t("graph.detail.status")}</p><StatusBadge value={node.status} /></div>
              <div><p className="text-xs text-muted-foreground">{t("graph.detail.revision")}</p><p>{node.revision ?? "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">{t("graph.detail.updated")}</p><p>{node.updatedAt ? formatDate(node.updatedAt) : "—"}</p></div>
            </div>
            <div><p className="text-xs text-muted-foreground">{t("graph.detail.tags")}</p><div className="mt-1 flex flex-wrap gap-1">{node.tags.length ? node.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>) : <span className="text-muted-foreground">{t("graph.detail.noTags")}</span>}</div></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={exhausted} loading={busy} onClick={onExpand} size="sm" variant="outline"><UnfoldVertical aria-hidden="true" />{exhausted ? t("graph.expandExhausted") : t("graph.expand")}</Button>
            <Button onClick={onOpenMemory} size="sm">{t("graph.openMemory")}</Button>
          </div>
        </>
      )}
      {node && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t("graph.detail.relationships")}</p>
          {relations.length ? (
            <div className="grid gap-1">
              {relations.map((relation, index) => (
                <Button
                  aria-label={t("graph.detail.relationshipLabel", { direction: t(`graph.relationDirection.${relation.direction}`), key: relation.key })}
                  className="grid h-auto w-full min-w-0 grid-cols-[auto_1fr] justify-start gap-x-2 px-2 py-1.5 text-left text-xs"
                  key={`${relation.direction}:${relation.origin}:${relation.key}:${index}`}
                  onClick={() => onSelect(relation.key)}
                  variant="ghost"
                >
                  <span className="text-muted-foreground">{relation.direction === "incoming" ? "←" : "→"}</span>
                  <span className="min-w-0">
                    <code className="block truncate">{relation.resolved ? relation.key : `? ${relation.key}`}</code>
                    <span className="text-muted-foreground">{t(`graph.origins.${relation.origin}`)} · {t("graph.detail.occurrences", { occurrences: String(relation.occurrences) })}</span>
                  </span>
                </Button>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">{t("graph.detail.noRelationships")}</p>}
        </div>
      )}
    </div>
  );
}
