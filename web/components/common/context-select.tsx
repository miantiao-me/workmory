import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { VariantProps } from "class-variance-authority";
import { PlusIcon } from "lucide-react";
import { ContextCreateDialog, type ContextCreateKind } from "../dialogs/context-create-dialog";
import { Select, SelectItem, SelectPopup, SelectSeparator, SelectTrigger, SelectValue, selectTriggerVariants } from "../ui/select";

// Identifiers must start with a letter or digit, so this sentinel can never collide with one.
const CREATE_SENTINEL = "__create__";

export type ContextSelectKind = ContextCreateKind;

export function ContextSelect({ kind, id, value, options, onValueChange, disabled = false, placeholder, className, size = "default", showLabel = false, ariaInvalid, ariaDescribedBy }: {
  kind: ContextSelectKind;
  id?: string;
  value: string;
  options: string[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  size?: VariantProps<typeof selectTriggerVariants>["size"];
  showLabel?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const label = t(kind === "project" ? "common.fields.project" : "common.fields.namespace");
  const createLabel = t(kind === "project" ? "contextSelect.createProject" : "contextSelect.createNamespace");
  const sortedOptions = [...new Set(value ? [...options, value] : options)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return (
    <>
      <Select
        disabled={disabled}
        onValueChange={(next) => {
          if (next === CREATE_SENTINEL) {
            setCreateOpen(true);
            return;
          }
          if (next) onValueChange(next);
        }}
        value={value || null}
      >
        <SelectTrigger aria-describedby={ariaDescribedBy} aria-invalid={ariaInvalid || undefined} aria-label={label} className={className} id={id} size={size}>
          <SelectValue className={showLabel ? "flex min-w-0 items-center gap-1" : undefined}>
            {(selected) => showLabel
              ? (
                  <>
                    <span className="shrink-0 text-muted-foreground">{label}:</span>
                    <span className="min-w-0 truncate font-mono">{selected || placeholder || t("contextSelect.placeholder", { label })}</span>
                  </>
                )
              : selected || placeholder || t("contextSelect.placeholder", { label })}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {sortedOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
          <SelectSeparator />
          <SelectItem className="text-muted-foreground" value={CREATE_SENTINEL}>
            <span className="flex items-center gap-2">
              <PlusIcon aria-hidden="true" />
              {createLabel}
            </span>
          </SelectItem>
        </SelectPopup>
      </Select>
      <ContextCreateDialog kind={kind} onCreate={onValueChange} onOpenChange={setCreateOpen} open={createOpen} />
    </>
  );
}
