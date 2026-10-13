export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_MARKDOWN_BYTES = 900 * 1024;

export type AttachmentStatus = "processing" | "ready" | "failed" | "deleting" | "deleted";
export type AttachmentSourceKind = "upload" | "url";
export type AttachmentLifecycle = "user" | "memory_source";

export interface AttachmentMetadata {
  id: string;
  project: string;
  status: AttachmentStatus;
  sourceKind: AttachmentSourceKind;
  sourceUrl?: string;
  filename: string;
  declaredMime?: string;
  detectedMime: string;
  originalSize: number;
  originalSha256: string;
  markdownSize?: number;
  markdownSha256?: string;
  conversionId?: string;
  conversionTokens?: number;
  converter?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  reused?: boolean;
}

export interface AttachmentContent {
  metadata: AttachmentMetadata;
  bytes: Uint8Array;
}

export interface MemoryAttachment {
  id: string;
  filename: string;
  markdown: string;
  source: string;
}

export interface MemoryAttachmentSource {
  resolve(project: string, attachmentId: string): Promise<MemoryAttachment>;
  importUrl(input: RemoteImportInput): Promise<MemoryAttachment>;
}

export interface RemoteImportInput {
  project: string;
  url: string;
  idempotencyKey: string;
  lifecycle?: AttachmentLifecycle;
}

export type AttachmentErrorCode =
  | "ATTACHMENT_NOT_FOUND"
  | "ATTACHMENT_NOT_READY"
  | "ATTACHMENT_PROCESSING"
  | "ATTACHMENT_FAILED"
  | "ATTACHMENT_REFERENCED"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_FILENAME"
  | "PAYLOAD_TOO_LARGE"
  | "HASH_MISMATCH"
  | "UNSUPPORTED_MEDIA"
  | "EMPTY_BODY"
  | "CONVERSION_FAILED"
  | "CONVERSION_UNAVAILABLE"
  | "CONVERSION_TIMEOUT"
  | "REMOTE_URL_INVALID"
  | "REMOTE_REDIRECT_LIMIT"
  | "REMOTE_FETCH_FAILED"
  | "REMOTE_TIMEOUT"
  | "INTEGRITY_ERROR";

export class AttachmentServiceError extends Error {
  constructor(
    public readonly code: AttachmentErrorCode,
    public readonly status: number,
    message: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AttachmentServiceError";
  }
}
