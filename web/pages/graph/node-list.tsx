import type { MemoryGraphNode } from "../../lib/api/types";
import { StatusBadge } from "../../components/common";
import { ListItem, ListItemBadges, ListItemContent, ListItemHeader, ListItemSpanningTrigger, ListItemTitle } from "../../components/list-item";
import { cn } from "../../lib/utils";
import { nodeFilterState, type GraphFilters } from "./model";

export function GraphNodeList({ nodes, filters, selected, onSelect }: {
  nodes: MemoryGraphNode[];
  filters: GraphFilters;
  selected?: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div role="list">
      {nodes.map((node) => {
        const searchMatch = nodeFilterState(node, filters).searchMatch;
        const isSelected = selected === node.key;
        return (
          <ListItem className={cn(isSelected && "bg-muted")} key={node.key} role="listitem">
            <ListItemContent>
              <ListItemHeader>
                <ListItemTitle className="min-w-0 font-normal">
                  <ListItemSpanningTrigger
                    aria-pressed={isSelected}
                    className="flex min-w-0 items-center gap-2 text-left disabled:cursor-not-allowed"
                    onClick={() => onSelect(node.key)}
                    render={<button type="button" />}
                  >
                    <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", node.resolved ? (isSelected ? "bg-primary" : "bg-muted-foreground") : "bg-destructive")} />
                    <code className={cn("truncate", !searchMatch && "opacity-50")}>{node.resolved ? node.key : `? ${node.key}`}</code>
                  </ListItemSpanningTrigger>
                </ListItemTitle>
              </ListItemHeader>
            </ListItemContent>
            {node.status ? <ListItemBadges className="shrink-0"><StatusBadge value={node.status} /></ListItemBadges> : null}
          </ListItem>
        );
      })}
    </div>
  );
}
