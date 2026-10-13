import type { FormEvent } from "react";
import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ErrorAlert } from "../common";
import { Button } from "../ui/button";
import { DialogFooter, DialogPanel } from "../ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { Form } from "../ui/form";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export function CheckpointForm({ project, namespace, content, summary, operationId, pending, error, onContentChange, onSummaryChange, onOperationIdChange, onCancel, onSubmit }: {
  project: string;
  namespace: string;
  content: string;
  summary: string;
  operationId: string;
  pending: boolean;
  error: string;
  onContentChange: (value: string) => void;
  onSummaryChange: (value: string) => void;
  onOperationIdChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const { t } = useTranslation();
  return (
    <Form className="contents" onSubmit={onSubmit}>
      <DialogPanel className="grid gap-4">
        {error && <ErrorAlert message={error} />}
        <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
          <span>{t("common.fields.project")}: {project || "—"}</span>
          <span>{t("common.fields.namespace")}: {namespace || "—"}</span>
        </p>
        <Field name="content">
          <FieldLabel htmlFor="checkpoint-content">{t("checkpoint.content")}</FieldLabel>
          <Textarea aria-describedby="checkpoint-content-hint" className="min-h-40" disabled={pending} id="checkpoint-content" maxLength={1_048_576} onChange={(event) => onContentChange(event.target.value)} required value={content} />
          <FieldDescription id="checkpoint-content-hint">{t("checkpoint.contentHint", { count: content.length })}</FieldDescription>
          <FieldError match role="alert">{t("checkpoint.contentRequired")}</FieldError>
        </Field>
        <Field name="summary">
          <FieldLabel htmlFor="checkpoint-summary">{t("checkpoint.summary")}</FieldLabel>
          <Input aria-describedby="checkpoint-summary-hint" disabled={pending} id="checkpoint-summary" maxLength={500} onChange={(event) => onSummaryChange(event.target.value)} type="text" value={summary} />
          <FieldDescription id="checkpoint-summary-hint">{t("checkpoint.summaryHint", { count: summary.length })}</FieldDescription>
        </Field>
        <Field name="operation_id">
          <FieldLabel htmlFor="checkpoint-operation">operation_id</FieldLabel>
          <Input aria-describedby="checkpoint-operation-hint" className="font-mono text-xs" disabled={pending} id="checkpoint-operation" maxLength={128} minLength={8} onChange={(event) => onOperationIdChange(event.target.value)} required type="text" value={operationId} />
          <FieldDescription id="checkpoint-operation-hint">{t("checkpoint.operationHint")}</FieldDescription>
          <FieldError match role="alert">{t("checkpoint.operationIdInvalid")}</FieldError>
        </Field>
      </DialogPanel>
      <DialogFooter>
        <Button disabled={pending} onClick={onCancel} type="button" variant="ghost">{t("common.cancel")}</Button>
        <Button loading={pending} type="submit"><Save aria-hidden="true" />{t("checkpoint.save")}</Button>
      </DialogFooter>
    </Form>
  );
}
