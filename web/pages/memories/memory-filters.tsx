import { SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Drawer,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
} from "../../components/ui/drawer";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { parseTagsInput } from "../../lib/presentation";

export interface MemoryFilterDraft {
  kind: string;
  status: string;
  tags: string;
}

interface MemoryFiltersProps {
  activeFilterCount: number;
  draft: MemoryFilterDraft;
  onDraftChange: (next: MemoryFilterDraft) => void;
  semanticWeight: number;
  onSemanticWeightChange: (next: number) => void;
  searchActive: boolean;
}

export function MemoryFilters({
  activeFilterCount,
  draft,
  onDraftChange,
  semanticWeight,
  onSemanticWeightChange,
  searchActive,
}: MemoryFiltersProps) {
  const { t } = useTranslation();

  return (
    <Drawer position="right">
      <DrawerTrigger
        aria-label={`${t("memories.kind")}, ${t("memories.status")}, ${t("memories.tags")}`}
        render={<Button className="shrink-0" variant="outline" />}
      >
        <SlidersHorizontal />
        <span className="hidden xl:inline">
          {t("memories.kind")} · {t("memories.tags")}
        </span>
        {activeFilterCount > 0 && (
          <Badge className="tabular-nums" variant="secondary">
            {activeFilterCount}
          </Badge>
        )}
      </DrawerTrigger>
      <DrawerPopup showCloseButton>
        <DrawerHeader>
          <DrawerTitle>{t("memories.search")}</DrawerTitle>
        </DrawerHeader>
        <DrawerPanel>
          <div className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="memory-kind">{t("memories.kind")}</FieldLabel>
              <Input
                id="memory-kind"
                maxLength={128}
                onChange={(event) => onDraftChange({ ...draft, kind: event.target.value })}
                placeholder={t("memories.kindPlaceholder")}
                type="text"
                value={draft.kind}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="memory-status">{t("memories.status")}</FieldLabel>
              <Input
                id="memory-status"
                maxLength={64}
                onChange={(event) => onDraftChange({ ...draft, status: event.target.value })}
                type="text"
                value={draft.status}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="memory-tags">{t("memories.tags")}</FieldLabel>
              <Input
                aria-describedby="memory-tags-hint"
                id="memory-tags"
                maxLength={2_079}
                onChange={(event) => onDraftChange({ ...draft, tags: event.target.value })}
                placeholder={t("memories.tagsPlaceholder")}
                type="text"
                value={draft.tags}
              />
              <FieldDescription id="memory-tags-hint">
                {t("memories.tagCount", { count: parseTagsInput(draft.tags).length })}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="semantic-weight">
                {t("memories.semanticWeight")}
              </FieldLabel>
              <Input
                aria-describedby="semantic-weight-hint"
                disabled={!searchActive}
                id="semantic-weight"
                inputMode="decimal"
                max={1}
                min={0}
                onChange={(event) => {
                  const next = event.target.valueAsNumber;
                  if (Number.isFinite(next) && next >= 0 && next <= 1) onSemanticWeightChange(next);
                }}
                step={0.05}
                type="number"
                value={semanticWeight}
              />
              <FieldDescription id="semantic-weight-hint">
                {searchActive
                  ? t("memories.currentWeight", { weight: semanticWeight.toFixed(2) })
                  : t("memories.weightInactive")}
              </FieldDescription>
            </Field>
          </div>
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  );
}
