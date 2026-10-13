import type { FormEvent } from "react";
import { FileSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextSelect } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Card, CardPanel } from "../../components/ui/card";
import { Field, FieldDescription, FieldLabel } from "../../components/ui/field";
import { Form } from "../../components/ui/form";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../components/ui/input-group";

export function AttachmentLookupForm({ project, projectOptions, busy, attachmentId, pending, onProjectChange, onAttachmentIdChange, onSubmit }: {
  project: string;
  projectOptions: string[];
  busy: boolean;
  attachmentId: string;
  pending: boolean;
  onProjectChange: (value: string) => void;
  onAttachmentIdChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardPanel className="p-0">
        <Form onSubmit={onSubmit}>
          <fieldset className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-[1fr_1fr_auto] lg:items-end" disabled={busy}>
            <Field>
              <FieldLabel htmlFor="attachment-query-project">{t("attachments.queryProject")}</FieldLabel>
              <ContextSelect
                disabled={busy}
                id="attachment-query-project"
                kind="project"
                onValueChange={onProjectChange}
                options={projectOptions}
                value={project}
              />
              <FieldDescription>{t("attachments.queryProjectHint")}</FieldDescription>
            </Field>

            <Field className="min-w-0">
              <FieldLabel htmlFor="attachment-id">{t("attachments.attachmentId")}</FieldLabel>
              <InputGroup>
                <InputGroupInput className="font-mono" id="attachment-id" maxLength={36} onChange={(event) => onAttachmentIdChange(event.target.value)} placeholder="att_…" type="text" value={attachmentId} />
                <InputGroupAddon><FileSearch aria-hidden="true" /></InputGroupAddon>
              </InputGroup>
              <FieldDescription>{t("attachments.queryDescription")}</FieldDescription>
            </Field>

            <Button className="w-full self-end sm:col-span-2 lg:col-span-1 lg:mb-5 lg:w-fit" loading={pending} type="submit"><FileSearch aria-hidden="true" />{t("attachments.query")}</Button>
          </fieldset>
        </Form>
      </CardPanel>
    </Card>
  );
}
