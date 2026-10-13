import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage, stableIdentifier } from "../../lib/presentation";
import { Button } from "../ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { Form } from "../ui/form";
import { Input } from "../ui/input";

export type ContextCreateKind = "project" | "namespace";

const MAX_LENGTHS: Record<ContextCreateKind, number> = { project: 128, namespace: 64 };

export function ContextCreateDialog({ open, kind, onOpenChange, onCreate }: {
  open: boolean;
  kind: ContextCreateKind;
  onOpenChange: (open: boolean) => void;
  onCreate: (value: string) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const label = t(kind === "project" ? "common.fields.project" : "common.fields.namespace");

  useEffect(() => {
    if (!open) return;
    setName("");
    setError("");
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    try {
      const identifier = stableIdentifier(name, label, MAX_LENGTHS[kind]);
      onCreate(identifier);
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-md" initialFocus={inputRef}>
        <DialogHeader>
          <DialogTitle>{t(kind === "project" ? "contextCreate.projectTitle" : "contextCreate.namespaceTitle")}</DialogTitle>
          <DialogDescription>{t("contextCreate.description", { label })}</DialogDescription>
        </DialogHeader>
        <Form className="contents" onSubmit={submit}>
          <DialogPanel>
            <Field invalid={Boolean(error)}>
              <FieldLabel htmlFor={inputId}>{t("contextCreate.nameLabel", { label })}</FieldLabel>
              <Input
                aria-describedby={error ? errorId : hintId}
                aria-invalid={error ? true : undefined}
                ref={inputRef}
                id={inputId}
                maxLength={MAX_LENGTHS[kind]}
                nativeInput
                onChange={(event) => {
                  setName(event.target.value);
                  if (error) setError("");
                }}
                placeholder={t("contextCreate.namePlaceholder")}
                type="text"
                value={name}
              />
              {error
                ? <FieldError id={errorId} match role="alert">{error}</FieldError>
                : <FieldDescription id={hintId}>{t("contextCreate.hint", { max: String(MAX_LENGTHS[kind]) })}</FieldDescription>}
            </Field>
          </DialogPanel>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">{t("common.cancel")}</Button>
            <Button type="submit">{t("common.confirm")}</Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
