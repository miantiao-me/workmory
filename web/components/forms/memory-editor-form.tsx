import { useEffect, useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MemoryRecord } from "../../../server/domain/memory";
import type { StoreInput } from "../../../server/mcp/memory-contracts";
import { DetailItem, DetailList, ErrorAlert } from "../common";
import { Button } from "../ui/button";
import { DialogFooter, DialogPanel } from "../ui/dialog";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { Form } from "../ui/form";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { useApp } from "../../context/app-context";
import { errorMessage, makeOperationId, operationIdFromInput, parseJsonObject, parseTagsInput, stableIdentifier, tagsFromInput, UserFacingError } from "../../lib/presentation";

const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const MAX_MEMORY_CONTENT = 1_048_576;
type SourceType = "content" | "okf_markdown" | "attachment_id" | "source_url";

export function MemoryEditorForm({ open, project, namespace, current, onCancel, onSaved, onPendingChange }: {
  open: boolean;
  project: string;
  namespace: string;
  current?: MemoryRecord;
  onCancel: () => void;
  onSaved: (record: MemoryRecord) => Promise<void>;
  onPendingChange: (pending: boolean) => void;
}) {
  const { t } = useTranslation();
  const { api, handleApiError } = useApp();
  const [key, setKey] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("content");
  const [source, setSource] = useState("");
  const [kind, setKind] = useState("");
  const [tags, setTags] = useState("");
  const [frontmatter, setFrontmatter] = useState("");
  const [operationId, setOperationId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const sourceLabels: Record<SourceType, string> = {
    content: t("memoryEditor.contentOption"),
    okf_markdown: t("memoryEditor.okfOption"),
    attachment_id: t("memoryEditor.attachmentOption"),
    source_url: t("memoryEditor.urlOption"),
  };

  useEffect(() => {
    if (!open) return;
    setKey(current?.key ?? "");
    setSourceType(current ? "okf_markdown" : "content");
    setSource(current?.okfMarkdown ?? "");
    setKind(current?.kind ?? "");
    setTags(current?.tags.join(", ") ?? "");
    setFrontmatter("");
    setOperationId(makeOperationId(current ? "memory-revise" : "memory-store"));
    setError("");
  }, [current, open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError("");
    try {
      const validatedProject = stableIdentifier(project, t("common.fields.project"), 128);
      const validatedNamespace = stableIdentifier(namespace, t("common.fields.namespace"), 64);
      const validatedKey = key.trim();
      if (!keyPattern.test(validatedKey) || validatedKey.length > 256) throw new UserFacingError(t("memoryEditor.validation.key"));
      if (source.length < 1) throw new UserFacingError(t("memoryEditor.validation.sourceRequired"));
      if ((sourceType === "content" || sourceType === "okf_markdown") && source.length > MAX_MEMORY_CONTENT) throw new UserFacingError(t("memoryEditor.validation.contentLength"));
      const normalizedSource = sourceType === "content" || sourceType === "okf_markdown" ? source : source.trim();
      if (sourceType === "attachment_id" && !/^att_[a-f0-9]{32}$/.test(normalizedSource)) throw new UserFacingError(t("memoryEditor.validation.attachmentId"));
      if (sourceType === "source_url") {
        let url: URL;
        try { url = new URL(normalizedSource); } catch { throw new UserFacingError(t("memoryEditor.validation.sourceUrl")); }
        if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new UserFacingError(t("memoryEditor.validation.sourceUrl"));
      }
      const validatedKind = kind.trim();
      if (validatedKind.length > 128) throw new UserFacingError(t("memoryEditor.validation.kindLength"));
      const validatedTags = tagsFromInput(tags);
      const validatedOperationId = operationIdFromInput(operationId, sourceType === "source_url");
      const input: StoreInput = {
        project: validatedProject,
        namespace: validatedNamespace,
        key: validatedKey,
        [sourceType]: normalizedSource,
        ...(validatedKind ? { kind: validatedKind } : {}),
        ...(validatedTags.length ? { tags: validatedTags } : {}),
        ...(frontmatter.trim() ? { frontmatter: parseJsonObject(frontmatter, "Frontmatter") } : {}),
        ...(current ? { expected_revision: current.revision } : {}),
        ...(validatedOperationId ? { operation_id: validatedOperationId } : {}),
      } as StoreInput;
      setPending(true);
      onPendingChange(true);
      const result = await api.memoryStore(input);
      await onSaved(result.record);
    } catch (cause) {
      handleApiError(cause);
      setError(errorMessage(cause));
    } finally {
      setPending(false);
      onPendingChange(false);
    }
  }

  return (
    <Form className="contents" onSubmit={submit}>
      <DialogPanel className="grid gap-4">
        {error && <ErrorAlert message={error} />}

        <section className="grid gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold text-sm">{t("memoryEditor.sections.identity")}</h3>
            <p className="text-muted-foreground text-xs">{t("memoryEditor.sections.identityDescription")}</p>
          </div>
          <DetailList className="gap-y-2 sm:gap-y-2">
            <DetailItem label={t("common.fields.project")} mono value={project} />
            <DetailItem label={t("common.fields.namespace")} mono value={namespace} />
          </DetailList>
          <Field name="key">
            <FieldLabel htmlFor="editor-key">Key</FieldLabel>
            <Input className="font-mono" disabled={Boolean(current)} id="editor-key" maxLength={256} onChange={(event) => setKey(event.target.value)} placeholder={t("memoryEditor.keyPlaceholder")} required type="text" value={key} />
          </Field>
        </section>

        <section className="grid gap-4 border-t pt-4">
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold text-sm">{t("memoryEditor.sections.source")}</h3>
            <p className="text-muted-foreground text-xs">{t("memoryEditor.sections.sourceDescription")}</p>
          </div>
          <Field>
            <FieldLabel htmlFor="editor-source-type">{t("memoryEditor.sourceType")}</FieldLabel>
            <Select disabled={Boolean(current)} onValueChange={(value) => { if (!value) return; setSourceType(value as SourceType); setSource(""); }} value={sourceType}>
              <SelectTrigger id="editor-source-type"><SelectValue>{(value) => sourceLabels[value as SourceType]}</SelectValue></SelectTrigger>
              <SelectPopup>{(Object.entries(sourceLabels) as [SourceType, string][]).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectPopup>
            </Select>
          </Field>
          <Field name="source">
            <FieldLabel htmlFor="editor-source">{sourceType === "content" ? t("memoryEditor.content") : sourceType === "okf_markdown" ? t("memoryEditor.okfOption") : sourceType === "attachment_id" ? t("memoryEditor.attachmentId") : t("memoryEditor.sourceUrl")}</FieldLabel>
            {sourceType === "content" || sourceType === "okf_markdown" ? <Textarea aria-describedby="editor-source-hint" className="min-h-48 font-mono text-sm" id="editor-source" maxLength={MAX_MEMORY_CONTENT} onChange={(event) => setSource(event.target.value)} required value={source} /> : <Input aria-describedby="editor-source-hint" id="editor-source" maxLength={sourceType === "attachment_id" ? 36 : undefined} onChange={(event) => setSource(event.target.value)} required type="text" value={source} />}
            <FieldDescription id="editor-source-hint">{sourceType === "attachment_id" ? t("memoryEditor.attachmentHint") : sourceType === "source_url" ? t("memoryEditor.urlHint") : t("memoryEditor.characterCount", { count: source.length })}</FieldDescription>
          </Field>
        </section>

        <section className="grid gap-4 border-t pt-4">
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold text-sm">{t("memoryEditor.sections.metadata")}</h3>
            <p className="text-muted-foreground text-xs">{t("memoryEditor.sections.metadataDescription")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="kind"><FieldLabel htmlFor="editor-kind">{t("memoryEditor.kind")}</FieldLabel><Input id="editor-kind" maxLength={128} onChange={(event) => setKind(event.target.value)} type="text" value={kind} /></Field>
            <Field name="tags"><FieldLabel htmlFor="editor-tags">{t("memoryEditor.tags")}</FieldLabel><Input aria-describedby="editor-tags-hint" id="editor-tags" maxLength={2_079} onChange={(event) => setTags(event.target.value)} placeholder={t("memoryEditor.tagsPlaceholder")} type="text" value={tags} /><FieldDescription id="editor-tags-hint">{t("memoryEditor.tagCount", { count: parseTagsInput(tags).length })}</FieldDescription></Field>
          </div>
          <Field name="frontmatter"><FieldLabel htmlFor="editor-frontmatter">Frontmatter JSON</FieldLabel><Textarea aria-describedby="editor-frontmatter-hint" className="min-h-24 font-mono text-xs" id="editor-frontmatter" onChange={(event) => setFrontmatter(event.target.value)} placeholder={'{"title":"…"}'} value={frontmatter} /><FieldDescription id="editor-frontmatter-hint">{t("memoryEditor.frontmatterHint")}</FieldDescription></Field>
        </section>

        <section className="grid gap-4 border-t pt-4">
          <h3 className="font-semibold text-sm">{t("memoryEditor.sections.retry")}</h3>
          <Field name="operation_id"><FieldLabel htmlFor="editor-operation">operation_id</FieldLabel><Input aria-describedby="editor-operation-hint" className="font-mono" id="editor-operation" maxLength={128} minLength={8} onChange={(event) => setOperationId(event.target.value)} type="text" value={operationId} /><FieldDescription id="editor-operation-hint">{t("memoryEditor.operationHint")}</FieldDescription></Field>
        </section>
      </DialogPanel>
      <DialogFooter>
        <Button disabled={pending} onClick={onCancel} type="button" variant="ghost">{t("memoryEditor.cancel")}</Button>
        <Button loading={pending} type="submit"><Save aria-hidden="true" />{current ? t("memoryEditor.saveRevision") : t("memoryEditor.create")}</Button>
      </DialogFooter>
    </Form>
  );
}
