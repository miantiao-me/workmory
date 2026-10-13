import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextSelect } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../components/ui/input-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../components/ui/select";
import type { MemoryGraphDirection } from "../../lib/api/types";

function GraphSelect({ label, value, values, onValueChange }: { label: string; value: string; values: string[]; onValueChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <Select onValueChange={(next) => onValueChange(next ?? "")} value={value || "__all__"}>
      <SelectTrigger aria-label={label} className="w-36"><SelectValue>{(current) => (current === "__all__" ? `${label}: ${t("graph.all")}` : current)}</SelectValue></SelectTrigger>
      <SelectPopup>
        <SelectItem value="__all__">{label}: {t("graph.all")}</SelectItem>
        {values.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
      </SelectPopup>
    </Select>
  );
}

export function GraphToolbar({ search, onSearchChange, project, namespace, projectOptions, namespaceOptions, directoryLoading, onSelectContext, kind, status, tags, kinds, statuses, onKindChange, onStatusChange, onTagsChange, direction, onDirectionChange, includeBroken, onToggleBroken }: {
  search: string;
  onSearchChange: (value: string) => void;
  project: string;
  namespace: string;
  projectOptions: string[];
  namespaceOptions: string[];
  directoryLoading: boolean;
  onSelectContext: (type: "project" | "namespace", value: string) => void;
  kind: string;
  status: string;
  tags: string;
  kinds: string[];
  statuses: string[];
  onKindChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  direction: MemoryGraphDirection;
  onDirectionChange: (value: MemoryGraphDirection) => void;
  includeBroken: boolean;
  onToggleBroken: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <InputGroup className="w-full sm:max-w-xs"><InputGroupInput aria-label={t("graph.search")} onChange={(event) => onSearchChange(event.target.value)} placeholder={t("graph.searchPlaceholder")} type="search" value={search} /><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon></InputGroup>
      <ContextSelect className="w-44" disabled={directoryLoading} kind="project" onValueChange={(value) => onSelectContext("project", value)} options={projectOptions} showLabel value={project} />
      <ContextSelect className="w-40" disabled={directoryLoading} kind="namespace" onValueChange={(value) => onSelectContext("namespace", value)} options={namespaceOptions} showLabel value={namespace} />
      <GraphSelect label={t("graph.kind")} onValueChange={(value) => onKindChange(value === "__all__" ? "" : value)} value={kind} values={kinds} />
      <GraphSelect label={t("graph.status")} onValueChange={(value) => onStatusChange(value === "__all__" ? "" : value)} value={status} values={statuses} />
      <Input aria-label={t("graph.tags")} className="w-36" onChange={(event) => onTagsChange(event.target.value)} placeholder={t("graph.tags")} value={tags} />
      <Select onValueChange={(value) => value && onDirectionChange(value as MemoryGraphDirection)} value={direction}><SelectTrigger aria-label={t("graph.expandDirection")} className="w-40"><SelectValue>{(value) => t(`graph.directions.${String(value)}` as `graph.directions.${MemoryGraphDirection}`)}</SelectValue></SelectTrigger><SelectPopup>{(["both", "outbound", "inbound"] as const).map((value) => <SelectItem key={value} value={value}>{t(`graph.directions.${value}`)}</SelectItem>)}</SelectPopup></Select>
      <Button aria-pressed={includeBroken} onClick={onToggleBroken} variant={includeBroken ? "secondary" : "outline"}>{t("graph.includeBrokenOnExpand")}</Button>
    </div>
  );
}
