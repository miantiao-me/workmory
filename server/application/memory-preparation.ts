import { AttachmentServiceError, type MemoryAttachment, type MemoryAttachmentSource } from "../attachments/types";
import type { JsonObject } from "../domain/memory";
import { kindSchema, statusSchema, tagSchema } from "../domain/contracts";
import { nonEmptyString, normalizeMemoryTags } from "../domain/memory-normalization";
import { extractMemoryLinks, type MemoryLinkExtraction } from "../domain/memory-links";
import { serializeOkf, validateOkf } from "../domain/okf";
import { sha256Hex } from "../shared/crypto";
import { stableJson } from "../shared/stable-json";
import { MemoryServiceError, type DeleteMemoryRequest, type StoreMemoryRequest } from "./memory-service";

export interface PreparedMemory {
  markdown: string;
  hash: string;
  kind?: string;
  tags: string[];
  status: string;
  body: string;
  attachmentIds: string[];
  linkExtraction: MemoryLinkExtraction;
}

export function memoryRequestFingerprint(request: StoreMemoryRequest | DeleteMemoryRequest): Promise<string> {
  const { operationFingerprint: _internalFingerprint, ...withoutFingerprint } = request;
  if (!("indexable" in withoutFingerprint) || withoutFingerprint.indexable === false) return sha256Hex(stableJson(withoutFingerprint));
  const { indexable: _defaultIndexable, ...withoutDefault } = withoutFingerprint;
  return sha256Hex(stableJson(withoutDefault));
}

export async function resolveMemoryAttachment(
  request: StoreMemoryRequest,
  attachments?: MemoryAttachmentSource,
): Promise<MemoryAttachment | undefined> {
  try {
    if ("attachment_id" in request.source) {
      if (!attachments) throw new MemoryServiceError("UNAVAILABLE", "Attachment service is not configured");
      return await attachments.resolve(request.project, request.source.attachment_id);
    }
    if ("source_url" in request.source) {
      if (!request.operationId) throw new MemoryServiceError("INVALID_INPUT", "operation_id is required with source_url");
      if (!attachments) throw new MemoryServiceError("UNAVAILABLE", "Attachment service is not configured");
      return await attachments.importUrl({
        project: request.project,
        url: request.source.source_url,
        idempotencyKey: `memory-source-${request.operationId}`,
        lifecycle: "memory_source",
      });
    }
    return undefined;
  } catch (error) {
    if (error instanceof MemoryServiceError) throw error;
    if (error instanceof AttachmentServiceError) {
      const code = error.status === 409 ? "CONFLICT" : error.status >= 500 ? "UNAVAILABLE" : "INVALID_INPUT";
      throw new MemoryServiceError(code, error.message);
    }
    throw error;
  }
}

export async function prepareMemory(request: StoreMemoryRequest, attachment?: MemoryAttachment): Promise<PreparedMemory> {
  let body: string;
  let frontmatter: JsonObject;
  if ("okf_markdown" in request.source) {
    const sourceValidation = validateOkf(request.source.okf_markdown);
    if (!sourceValidation.valid || !sourceValidation.document) {
      throw new MemoryServiceError("INVALID_INPUT", sourceValidation.errors.join("; "));
    }
    body = sourceValidation.document.body;
    frontmatter = { ...sourceValidation.document.frontmatter };
  } else if ("content" in request.source) {
    body = request.source.content;
    frontmatter = {};
  } else if (attachment) {
    body = attachment.markdown;
    frontmatter = {};
  } else {
    throw new MemoryServiceError("UNAVAILABLE", "Attachment ingestion is not configured");
  }

  frontmatter = { ...request.provenance, ...frontmatter, ...request.frontmatter };
  if (!nonEmptyString(frontmatter.type)) frontmatter.type = request.kind ?? "Agent Memory";
  if (request.kind !== undefined) frontmatter.kind = request.kind;
  if (request.tags !== undefined) frontmatter.tags = request.tags;
  if (attachment) {
    const sources = Array.isArray(frontmatter.sources) ? frontmatter.sources : frontmatter.sources ? [frontmatter.sources] : [];
    frontmatter.sources = [...sources, { id: `attachment-${attachment.id}`, resource: attachment.source, title: attachment.filename }];
  }

  const markdown = serializeOkf({ frontmatter, body });
  const validation = validateOkf(markdown);
  if (!validation.valid || !validation.document) {
    throw new MemoryServiceError("INVALID_INPUT", validation.errors.join("; "));
  }
  const projectedKind = request.kind ?? nonEmptyString(frontmatter.kind);
  if (projectedKind !== undefined && !kindSchema.safeParse(projectedKind).success) {
    throw new MemoryServiceError("INVALID_INPUT", "kind exceeds its UTF-8 byte limit");
  }
  if (!statusSchema.safeParse(validation.document.normalized.status).success) {
    throw new MemoryServiceError("INVALID_INPUT", "status exceeds its UTF-8 byte limit");
  }
  if (Array.isArray(frontmatter.tags) && frontmatter.tags.some((tag) => !tagSchema.safeParse(tag).success)) {
    throw new MemoryServiceError("INVALID_INPUT", "tag exceeds its UTF-8 byte limit or is invalid");
  }
  return {
    markdown,
    hash: await sha256Hex(markdown),
    kind: projectedKind,
    tags: normalizeMemoryTags(frontmatter.tags),
    status: validation.document.normalized.status,
    body,
    attachmentIds: attachment ? [attachment.id] : [],
    linkExtraction: extractMemoryLinks(request.key, body, frontmatter.sources),
  };
}

export async function prepareRestoredMemory(
  request: Pick<StoreMemoryRequest, "project" | "namespace" | "key">,
  okfMarkdown: string,
  attachmentIds: string[],
): Promise<PreparedMemory> {
  const prepared = await prepareMemory({ ...request, source: { okf_markdown: okfMarkdown } });
  return { ...prepared, attachmentIds: [...attachmentIds] };
}
