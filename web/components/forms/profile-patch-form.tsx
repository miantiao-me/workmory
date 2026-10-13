import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProfileUpdateInput } from "../../../server/mcp/profile-contracts";
import { ErrorAlert } from "../common";
import { Button } from "../ui/button";
import { Card, CardFrame, CardFrameDescription, CardFrameFooter, CardFrameHeader, CardFrameTitle, CardPanel } from "../ui/card";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { Form } from "../ui/form";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Separator } from "../ui/separator";
import { Textarea } from "../ui/textarea";
import { useApp } from "../../context/app-context";
import { useCopyWithNotice } from "../../hooks/use-copy-with-notice";
import { cn } from "../../lib/utils";
import { errorMessage, makeOperationId, operationIdFromInput, UserFacingError } from "../../lib/presentation";

type Operation = ProfileUpdateInput["operations"][number]["op"];

export function ProfilePatchForm({ project, revision, onSaved, disabled, onPendingChange, state }: {
  project?: string;
  revision?: number;
  onSaved: () => Promise<void>;
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
  state?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { api, handleApiError, notify } = useApp();
  const [op, setOp] = useState<Operation>("set");
  const [section, setSection] = useState("");
  const [field, setField] = useState("");
  const [fieldValue, setFieldValue] = useState("");
  const [expectedRevision, setExpectedRevision] = useState("");
  const [operationId, setOperationId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const copyWithNotice = useCopyWithNotice();

  useEffect(() => {
    setExpectedRevision(revision === undefined ? "" : String(revision));
    setOperationId(makeOperationId("profile-update"));
  }, [project, revision]);

  useEffect(() => {
    if (op === "remove") {
      setFieldValue("");
      return;
    }
    const base = op === "set"
      ? { state: "set", value: "", provenance: { kind: "user_explicit", recorded_at: new Date().toISOString() }, sensitivity: "normal" }
      : { state: "suppressed", provenance: { kind: "user_explicit", recorded_at: new Date().toISOString() }, sensitivity: "normal" };
    setFieldValue(JSON.stringify(base, null, 2));
  }, [op]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (pending) return;
    try {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(section) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(field)) throw new UserFacingError(t("profilePatch.validation.path"));
      if (op === "suppress" && !project) throw new UserFacingError(t("profilePatch.validation.suppress"));
      let operation: ProfileUpdateInput["operations"][number];
      if (op === "remove") {
        operation = { op, section, field };
      } else {
        let parsed: unknown;
        try { parsed = JSON.parse(fieldValue); } catch { throw new UserFacingError(t("profilePatch.validation.fieldValue")); }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new UserFacingError(t("profilePatch.validation.fieldValue"));
        operation = { op, section, field, field_value: parsed } as ProfileUpdateInput["operations"][number];
      }
      const expected = expectedRevision.trim() ? Number(expectedRevision) : undefined;
      if (expected !== undefined && (!Number.isInteger(expected) || expected < 0)) throw new UserFacingError(t("profilePatch.validation.revision"));
      const validatedOperationId = operationIdFromInput(operationId);
      setPending(true);
      onPendingChange(true);
      await api.profileUpdate({
        ...(project ? { project } : {}),
        operations: [operation],
        ...(expected !== undefined ? { expected_revision: expected } : {}),
        ...(validatedOperationId ? { operation_id: validatedOperationId } : {}),
      });
      setOperationId(makeOperationId("profile-update"));
      await onSaved();
    } catch (cause) {
      handleApiError(cause);
      setError(errorMessage(cause));
    } finally {
      setPending(false);
      onPendingChange(false);
    }
  }

  const formDisabled = disabled || pending;

  return (
    <div className="grid w-full min-w-0 gap-4">
      {state}
      <CardFrame render={<Form onSubmit={submit} />}>
        <CardFrameHeader>
          <CardFrameTitle>{t("profilePatch.title")}</CardFrameTitle>
          <CardFrameDescription>{t("profilePatch.description")}</CardFrameDescription>
        </CardFrameHeader>
      <Card className="rounded-b-none!">
        <CardPanel>
          {error && <ErrorAlert message={error} />}
          <div className={cn("grid grid-cols-1 gap-6 md:grid-cols-2", error && "mt-6")}>
            <div className="col-span-full">
              <h2 className="font-semibold text-sm text-foreground">{t("profilePatch.targetTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("profilePatch.targetDescription")}</p>
            </div>

            <Field className="col-span-full">
              <FieldLabel htmlFor="profile-op">{t("profilePatch.operation")}</FieldLabel>
              <Select<Operation>
                disabled={formDisabled}
                items={{ set: t("profilePatch.operations.set"), remove: t("profilePatch.operations.remove"), suppress: t("profilePatch.operations.suppress") }}
                onValueChange={(value) => { if (value) setOp(value); }}
                value={op}
              >
                <SelectTrigger id="profile-op"><SelectValue /></SelectTrigger>
                <SelectPopup>
                  <SelectItem value="set">{t("profilePatch.operations.set")}</SelectItem>
                  <SelectItem value="remove">{t("profilePatch.operations.remove")}</SelectItem>
                  <SelectItem disabled={!project} value="suppress">{t("profilePatch.operations.suppress")}</SelectItem>
                </SelectPopup>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-section">{t("profilePatch.section")}</FieldLabel>
              <Input disabled={formDisabled} id="profile-section" maxLength={64} onChange={(event) => setSection(event.target.value)} required type="text" value={section} />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-field">{t("profilePatch.field")}</FieldLabel>
              <Input disabled={formDisabled} id="profile-field" maxLength={64} onChange={(event) => setField(event.target.value)} required type="text" value={field} />
            </Field>

            <div className="col-span-full">
              <Separator className="mb-6" />
              <h2 className="font-semibold text-sm text-foreground">{t("profilePatch.valueTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("profilePatch.valueDescription")}</p>
            </div>
            {op === "remove"
              ? <p className="col-span-full text-sm text-muted-foreground">{t("profilePatch.removeValueDescription")}</p>
              : (
                <Field className="col-span-full">
                  <FieldLabel htmlFor="profile-field-value">{t("profilePatch.fieldValue")}</FieldLabel>
                  <Textarea aria-describedby="profile-field-value-hint" className="min-h-52 font-mono text-xs" disabled={formDisabled} id="profile-field-value" onChange={(event) => setFieldValue(event.target.value)} required value={fieldValue} />
                  <FieldDescription id="profile-field-value-hint">{t("profilePatch.fieldValueHint")}</FieldDescription>
                </Field>
              )}

            <div className="col-span-full">
              <Separator className="mb-6" />
              <details className="group">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
                  <span>
                    <span className="block font-medium text-sm text-foreground">{t("profilePatch.revisionTitle")}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">{t("profilePatch.revisionDescription")}</span>
                  </span>
                  <ChevronDown aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="profile-revision">expected_revision</FieldLabel>
                    <Input className="font-mono" disabled={formDisabled} id="profile-revision" min="0" onChange={(event) => setExpectedRevision(event.target.value)} type="number" value={expectedRevision} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="profile-operation-id">operation_id</FieldLabel>
                    <InputGroup>
                      <InputGroupInput aria-describedby="profile-operation-id-hint" className="font-mono" disabled={formDisabled} id="profile-operation-id" maxLength={128} minLength={8} onChange={(event) => setOperationId(event.target.value)} type="text" value={operationId} />
                      <InputGroupAddon align="inline-end">
                        <Button aria-label={t("profilePatch.copyOperation")} disabled={formDisabled} onClick={() => copyWithNotice(operationId, t("profilePatch.operationCopied"))} size="icon-xs" type="button" variant="ghost"><Copy aria-hidden="true" /></Button>
                      </InputGroupAddon>
                    </InputGroup>
                    <FieldDescription id="profile-operation-id-hint">{t("profilePatch.operationHint")}</FieldDescription>
                  </Field>
                </div>
              </details>
            </div>
          </div>
        </CardPanel>
      </Card>
        <CardFrameFooter className="flex justify-end">
          <Button disabled={formDisabled} loading={pending} type="submit">{t("profilePatch.apply")}</Button>
        </CardFrameFooter>
      </CardFrame>
    </div>
  );
}
