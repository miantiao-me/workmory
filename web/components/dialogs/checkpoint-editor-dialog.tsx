import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { CheckpointForm } from "../forms/checkpoint-form";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";

export function CheckpointEditorDialog({ open, project, namespace, content, summary, operationId, pending, error, onOpenChange, onContentChange, onSummaryChange, onOperationIdChange, onSubmit }: {
  open: boolean;
  project: string;
  namespace: string;
  content: string;
  summary: string;
  operationId: string;
  pending: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onContentChange: (value: string) => void;
  onSummaryChange: (value: string) => void;
  onOperationIdChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-xl" closeProps={{ disabled: pending }}>
        <DialogHeader>
          <DialogTitle>{t("checkpoint.title")}</DialogTitle>
          <DialogDescription>{t("checkpoint.description")}</DialogDescription>
        </DialogHeader>
        <CheckpointForm
          content={content}
          error={error}
          namespace={namespace}
          onCancel={() => onOpenChange(false)}
          onContentChange={onContentChange}
          onOperationIdChange={onOperationIdChange}
          onSubmit={onSubmit}
          onSummaryChange={onSummaryChange}
          operationId={operationId}
          pending={pending}
          project={project}
          summary={summary}
        />
      </DialogPopup>
    </Dialog>
  );
}
