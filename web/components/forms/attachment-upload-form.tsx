import type { FormEvent } from "react";
import { useRef } from "react";
import { ChevronDown, Copy, Paperclip, UploadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextSelect } from "../common";
import { Button } from "../ui/button";
import { Card, CardPanel } from "../ui/card";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { Form } from "../ui/form";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";

const ACCEPTED_FORMATS = ".md,.markdown,.txt,.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.svg,.html,.htm,.xml,.xlsx,.xlsm,.xlsb,.xls,.docx,.ods,.odt,.csv,.numbers";

export function AttachmentUploadForm({ project, projectOptions, projectDirectoryLoading, idempotencyKey, busy, fileName, pending, onProjectChange, onFileChange, onIdempotencyKeyChange, onCopyKey, onSubmit }: {
  project: string;
  projectOptions: string[];
  projectDirectoryLoading: boolean;
  idempotencyKey: string;
  busy: boolean;
  fileName?: string;
  pending: boolean;
  onProjectChange: (value: string) => void;
  onFileChange: (file?: File) => void;
  onIdempotencyKeyChange: (value: string) => void;
  onCopyKey: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <Form onSubmit={onSubmit}>
      <Card>
        <CardPanel className="p-0">
      <fieldset className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3 lg:items-end" disabled={busy}>
        <Field className="min-w-0">
          <FieldLabel htmlFor="attachment-upload-project">{t("attachments.uploadProject")}</FieldLabel>
          <ContextSelect
            disabled={busy || projectDirectoryLoading}
            id="attachment-upload-project"
            kind="project"
            onValueChange={onProjectChange}
            options={projectOptions}
            value={project}
          />
          <FieldDescription>{t("attachments.uploadProjectHint")}</FieldDescription>
        </Field>

        <Field className="min-w-0">
          <FieldLabel htmlFor="attachment-file">{t("attachments.file")}</FieldLabel>
          <div className="flex w-full items-center gap-2">
            <input aria-describedby="attachment-file-hint" accept={ACCEPTED_FORMATS} className="peer sr-only" id="attachment-file" onChange={(event) => onFileChange(event.target.files?.[0])} ref={fileInput} tabIndex={-1} type="file" />
            <Button
              className="peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1"
              onClick={() => fileInput.current?.click()}
              type="button"
              variant="outline"
            >
              <Paperclip aria-hidden="true" />
              {t("attachments.chooseFile")}
            </Button>
            <span aria-live="polite" className="min-w-0 flex-1 truncate text-muted-foreground text-sm" title={fileName}>
              {fileName ?? t("attachments.noFile")}
            </span>
          </div>
          <FieldDescription id="attachment-file-hint">{t("attachments.formats")}</FieldDescription>
        </Field>

        <Button className="w-full self-end sm:col-span-2 lg:col-span-1 lg:mb-5 lg:w-fit" loading={pending} type="submit"><UploadCloud aria-hidden="true" />{t("attachments.upload")}</Button>

        <details className="group min-w-0 sm:col-span-2 lg:col-span-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
            Idempotency-Key
          </summary>
          <Field className="mt-3 max-w-2xl min-w-0">
            <FieldLabel className="sr-only" htmlFor="idempotency-key">Idempotency-Key</FieldLabel>
            <InputGroup>
              <InputGroupInput aria-describedby="idempotency-key-hint" className="font-mono text-xs" id="idempotency-key" maxLength={128} onChange={(event) => onIdempotencyKeyChange(event.target.value)} required type="text" value={idempotencyKey} />
              <InputGroupAddon align="inline-end">
                <Button aria-label={t("attachments.copyKey")} onClick={onCopyKey} size="icon-xs" type="button" variant="ghost"><Copy aria-hidden="true" /></Button>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription id="idempotency-key-hint">{t("attachments.idempotencyHint", { count: idempotencyKey.length })}</FieldDescription>
          </Field>
        </details>
      </fieldset>
        </CardPanel>
      </Card>
    </Form>
  );
}
