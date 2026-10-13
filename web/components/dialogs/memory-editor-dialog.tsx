import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MemoryRecord } from "../../../server/domain/memory";
import { MemoryEditorForm } from "../forms/memory-editor-form";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";

export function MemoryEditorDialog({ open, onOpenChange, project, namespace, current, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: string;
  namespace: string;
  current?: MemoryRecord;
  onSaved: (record: MemoryRecord) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && pending) return;
    onOpenChange(nextOpen);
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogPopup className="max-w-3xl" closeProps={{ disabled: pending }}>
        <DialogHeader>
          <DialogTitle>{current ? t("memoryEditor.reviseTitle") : t("memoryEditor.createTitle")}</DialogTitle>
          <DialogDescription>{current ? t("memoryEditor.reviseDescription", { revision: String(current.revision) }) : t("memoryEditor.createDescription")}</DialogDescription>
        </DialogHeader>
        <MemoryEditorForm current={current} namespace={namespace} onCancel={() => handleOpenChange(false)} onPendingChange={setPending} onSaved={onSaved} open={open} project={project} />
      </DialogPopup>
    </Dialog>
  );
}
