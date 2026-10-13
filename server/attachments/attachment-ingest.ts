import { projectOpaqueId } from "../domain/identity";
import { readBoundedStream, StreamLimitError, StreamReadAbortedError } from "../shared/bounded-stream";
import { logCleanupFailure } from "../shared/cleanup-failure";
import { sha256Hex } from "../shared/crypto";
import type { AttachmentObjectStore } from "../storage/attachment-object-store";
import { ObjectIntegrityError } from "../storage/r2-object-store";
import { AttachmentRepository } from "./attachment-repository";
import { bypassToMarkdown, type MarkdownConversion, type MarkdownConverter } from "./converter";
import { normalizeFilename, resolveAttachmentFormat } from "./formats";
import { ATTACHMENT_QUARANTINE_MS } from "./policy";
import { MAX_ATTACHMENT_BYTES, AttachmentServiceError, type AttachmentLifecycle, type AttachmentMetadata } from "./types";

export type AttachmentBody = ReadableStream<Uint8Array> | Uint8Array | ArrayBuffer | Blob;

export async function readAttachmentBody(
  input: AttachmentBody,
  contentLength?: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (contentLength !== undefined && (!Number.isFinite(contentLength) || contentLength < 0)) {
    throw new AttachmentServiceError("PAYLOAD_TOO_LARGE", 413, "Invalid Content-Length");
  }
  if (contentLength !== undefined && contentLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentServiceError("PAYLOAD_TOO_LARGE", 413, "Attachment exceeds 8 MiB");
  }
  if (input instanceof Uint8Array) {
    if (input.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentServiceError("PAYLOAD_TOO_LARGE", 413, "Attachment exceeds 8 MiB");
    }
    return input;
  }
  if (input instanceof ArrayBuffer) return readAttachmentBody(new Uint8Array(input), contentLength, signal);
  if (input instanceof Blob) {
    if (input.size > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentServiceError("PAYLOAD_TOO_LARGE", 413, "Attachment exceeds 8 MiB");
    }
    return readAttachmentBody(input.stream() as ReadableStream<Uint8Array>, contentLength, signal);
  }
  try {
    return await readBoundedStream(input, MAX_ATTACHMENT_BYTES, { contentLength, signal });
  } catch (error) {
    if (error instanceof StreamReadAbortedError) {
      throw new AttachmentServiceError("REMOTE_TIMEOUT", 504, "Remote attachment import timed out");
    }
    if (error instanceof StreamLimitError) {
      const message = error.reason === "invalid-content-length" ? "Invalid Content-Length" : "Attachment exceeds 8 MiB";
      throw new AttachmentServiceError("PAYLOAD_TOO_LARGE", 413, message);
    }
    throw error;
  }
}

export function assertIngestDeadline(deadlineAt: number | undefined, now: () => number): void {
  if (deadlineAt !== undefined && now() >= deadlineAt) {
    throw new AttachmentServiceError("REMOTE_TIMEOUT", 504, "Remote attachment import timed out");
  }
}

export async function withinDeadline<T>(operation: () => Promise<T>, deadlineAt: number | undefined, now: () => number): Promise<T> {
  if (deadlineAt === undefined) return operation();
  const remaining = deadlineAt - now();
  if (remaining <= 0) throw new AttachmentServiceError("REMOTE_TIMEOUT", 504, "Remote attachment import timed out");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AttachmentServiceError("REMOTE_TIMEOUT", 504, "Remote attachment import timed out")),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function throwStorageServiceError(error: unknown): never {
  if (error instanceof AttachmentServiceError) throw error;
  if (error instanceof ObjectIntegrityError) {
    throw new AttachmentServiceError("INTEGRITY_ERROR", 500, "Attachment object integrity validation failed");
  }
  throw new AttachmentServiceError("INTEGRITY_ERROR", 503, "Attachment storage is unavailable");
}

async function storeObject(operation: () => Promise<void>, deadlineAt: number | undefined, now: () => number): Promise<void> {
  try {
    await withinDeadline(operation, deadlineAt, now);
  } catch (error) {
    throwStorageServiceError(error);
  }
}

async function convertAttachment(operation: () => Promise<MarkdownConversion>): Promise<MarkdownConversion> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AttachmentServiceError) throw error;
    throw new AttachmentServiceError("CONVERSION_FAILED", 422, "Attachment conversion failed");
  }
}

function attachmentId(): string {
  return `att_${crypto.randomUUID().replaceAll("-", "")}`;
}

export interface IngestAttachmentInput {
  project: string;
  filename: string;
  declaredMime?: string;
  bytes: Uint8Array;
  idempotencyKey: string;
  sourceKind: "upload" | "url";
  sourceUrl?: string;
  fingerprintOverride?: string;
  expectedSha256?: string;
  deadlineAt?: number;
  lifecycle?: AttachmentLifecycle;
}

export class AttachmentIngestor {
  constructor(
    private readonly repository: AttachmentRepository,
    private readonly objectStore: AttachmentObjectStore,
    private readonly converter: MarkdownConverter,
    private readonly ownerId: string,
    private readonly now: () => number,
  ) {}

  async ingestAttachment(input: IngestAttachmentInput): Promise<AttachmentMetadata> {
    const originalSha256 = await sha256Hex(input.bytes);
    if (input.expectedSha256 && input.expectedSha256.toLowerCase() !== originalSha256) {
      throw new AttachmentServiceError("HASH_MISMATCH", 400, "Attachment SHA-256 does not match");
    }
    if (input.bytes.byteLength === 0) throw new AttachmentServiceError("EMPTY_BODY", 400, "Attachment body is empty");
    const filename = normalizeFilename(input.filename);
    const format = resolveAttachmentFormat(filename, input.declaredMime, input.bytes);
    const projectId = await projectOpaqueId(this.ownerId, input.project);
    const fingerprint = input.fingerprintOverride ?? await sha256Hex(JSON.stringify({
      filename,
      declaredMime: input.declaredMime?.toLowerCase() ?? null,
      originalSha256,
      sourceKind: input.sourceKind,
      lifecycle: input.lifecycle ?? "user",
      sourceFingerprint: null,
    }));
    const existingResult = await withinDeadline(
      () => this.repository.existingResult(projectId, input.idempotencyKey, fingerprint, input.project),
      input.deadlineAt,
      this.now,
    );
    if (existingResult) return existingResult;

    const id = attachmentId();
    const createdAt = this.now();
    const originalR2Key = `attachments/${projectId}/${id}/original/${originalSha256}`;
    const inserted = await withinDeadline(
      () => this.repository.insertProcessing({
      id,
      projectId,
      project: input.project,
      sourceKind: input.sourceKind,
      sourceUrl: input.sourceUrl,
      lifecycle: input.lifecycle ?? "user",
      filename,
      declaredMime: input.declaredMime,
      detectedMime: format.detectedMime,
      originalSize: input.bytes.byteLength,
      originalSha256,
      originalR2Key,
      idempotencyKey: input.idempotencyKey,
        fingerprint,
        now: createdAt,
      }),
      input.deadlineAt,
      this.now,
    );
    if (!inserted) {
      const racedResult = await withinDeadline(
        () => this.repository.existingResult(projectId, input.idempotencyKey, fingerprint, input.project),
        input.deadlineAt,
        this.now,
      );
      if (racedResult) return racedResult;
      throw new AttachmentServiceError("IDEMPOTENCY_CONFLICT", 409, "Attachment idempotency conflict");
    }

    try {
      assertIngestDeadline(input.deadlineAt, this.now);
      await storeObject(
        () => this.objectStore.put(originalR2Key, input.bytes, originalSha256, format.detectedMime),
        input.deadlineAt,
        this.now,
      );
      assertIngestDeadline(input.deadlineAt, this.now);
      const conversion = await convertAttachment(async () => format.bypassAi
        ? bypassToMarkdown(input.bytes)
        : this.converter.convert({
            filename,
            mimeType: format.detectedMime,
            bytes: input.bytes,
            deadlineAt: input.deadlineAt,
            now: this.now,
          }));
      assertIngestDeadline(input.deadlineAt, this.now);
      const markdownBytes = new TextEncoder().encode(conversion.markdown);
      const markdownSha256 = await sha256Hex(markdownBytes);
      const markdownR2Key = `attachments/${projectId}/${id}/markdown/${markdownSha256}`;
      assertIngestDeadline(input.deadlineAt, this.now);
      const staged = await withinDeadline(
        () => this.repository.stageMarkdown({
        id,
        markdownSize: markdownBytes.byteLength,
        markdownSha256,
        markdownR2Key,
        conversionId: conversion.id,
        conversionTokens: conversion.tokens,
          converter: conversion.converter,
          now: this.now(),
        }),
        input.deadlineAt,
        this.now,
      );
      if (!staged) {
        throw new AttachmentServiceError("ATTACHMENT_NOT_READY", 409, "Attachment processing state changed", { attachmentId: id });
      }
      assertIngestDeadline(input.deadlineAt, this.now);
      await storeObject(
        () => this.objectStore.put(markdownR2Key, markdownBytes, markdownSha256, "text/markdown; charset=utf-8"),
        input.deadlineAt,
        this.now,
      );
      assertIngestDeadline(input.deadlineAt, this.now);
      const markedReady = await this.repository.markReady(id, this.now());
      if (!markedReady) {
        throw new AttachmentServiceError("ATTACHMENT_NOT_READY", 409, "Attachment processing state changed", { attachmentId: id });
      }
      // The ready commit already succeeded; reading back the committed row is a
      // bounded local D1 lookup and must not be raced against the deadline, or a
      // successful write would surface as a timeout while the row stays ready.
      return this.repository.metadata(await this.repository.findReady(input.project, id), input.project);
    } catch (error) {
      const code = error instanceof AttachmentServiceError ? error.code : "INTEGRITY_ERROR";
      const failedAt = this.now();
      try {
        await this.repository.markFailed(id, code, failedAt, failedAt + ATTACHMENT_QUARANTINE_MS);
      } catch (markError) {
        logCleanupFailure("attachment markFailed", markError);
      }
      if (error instanceof AttachmentServiceError) throw error;
      throw new AttachmentServiceError("INTEGRITY_ERROR", 503, "Attachment infrastructure is unavailable", { attachmentId: id });
    }
  }
}
