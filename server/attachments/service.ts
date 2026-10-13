import type { ActorContext } from "../domain/identity";
import { logCleanupFailure } from "../shared/cleanup-failure";
import type { AttachmentObjectStore } from "../storage/attachment-object-store";
import { throwStorageServiceError, AttachmentIngestor, readAttachmentBody, type AttachmentBody } from "./attachment-ingest";
import { AttachmentRepository } from "./attachment-repository";
import type { MarkdownConverter } from "./converter";
import { RemoteAttachmentImporter, type RemoteImportOptions } from "./remote-import";
import {
  AttachmentServiceError,
  type AttachmentContent,
  type AttachmentMetadata,
  type MemoryAttachment,
  type MemoryAttachmentSource,
  type RemoteImportInput,
} from "./types";


export interface UploadAttachmentInput {
  project: string;
  filename: string;
  declaredMime?: string;
  body: AttachmentBody;
  contentLength?: number;
  expectedSha256?: string;
  idempotencyKey: string;
}

export class AttachmentService implements MemoryAttachmentSource {
  private readonly repository: AttachmentRepository;
  private readonly ingestor: AttachmentIngestor;
  private readonly remoteImporter: RemoteAttachmentImporter;
  private readonly now: () => number;

  constructor(
    db: D1Database,
    private readonly objectStore: AttachmentObjectStore,
    converter: MarkdownConverter,
    actor: ActorContext,
    options: RemoteImportOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.repository = new AttachmentRepository(db, actor);
    this.ingestor = new AttachmentIngestor(this.repository, objectStore, converter, actor.ownerId, this.now);
    this.remoteImporter = new RemoteAttachmentImporter(this.repository, this.ingestor, actor.ownerId, options);
  }

  async upload(input: UploadAttachmentInput): Promise<AttachmentMetadata> {
    const bytes = await readAttachmentBody(input.body, input.contentLength);
    return this.ingestor.ingestAttachment({ ...input, bytes, sourceKind: "upload" });
  }

  importRemote(input: RemoteImportInput): Promise<AttachmentMetadata> {
    return this.remoteImporter.importRemote(input);
  }

  private async getObject(key: string, expectedSha256: string): Promise<{ bytes: Uint8Array } | null> {
    try {
      return await this.objectStore.get(key, expectedSha256);
    } catch (error) {
      throwStorageServiceError(error);
    }
  }

  async getMetadata(project: string, id: string): Promise<AttachmentMetadata> {
    return this.repository.metadata(await this.repository.findReady(project, id), project);
  }

  async getOriginal(project: string, id: string): Promise<AttachmentContent> {
    const attachment = await this.repository.findReady(project, id);
    const object = await this.getObject(attachment.originalR2Key, attachment.originalSha256);
    if (!object) throw new AttachmentServiceError("INTEGRITY_ERROR", 500, "Attachment original object is missing");
    return { metadata: this.repository.metadata(attachment, project), bytes: object.bytes };
  }

  async getMarkdown(project: string, id: string): Promise<AttachmentContent> {
    const attachment = await this.repository.findReady(project, id);
    if (!attachment.markdownR2Key || !attachment.markdownSha256) {
      throw new AttachmentServiceError("INTEGRITY_ERROR", 500, "Attachment Markdown object is missing");
    }
    const object = await this.getObject(attachment.markdownR2Key, attachment.markdownSha256);
    if (!object) throw new AttachmentServiceError("INTEGRITY_ERROR", 500, "Attachment Markdown object is missing");
    return { metadata: this.repository.metadata(attachment, project), bytes: object.bytes };
  }

  async resolve(project: string, attachmentId: string): Promise<MemoryAttachment> {
    const content = await this.getMarkdown(project, attachmentId);
    return {
      id: content.metadata.id,
      filename: content.metadata.filename,
      markdown: new TextDecoder().decode(content.bytes),
      source: content.metadata.sourceUrl ?? `attachment:${content.metadata.id}`,
    };
  }

  async importUrl(input: RemoteImportInput): Promise<MemoryAttachment> {
    const attachment = await this.importRemote(input);
    return this.resolve(input.project, attachment.id);
  }

  async delete(project: string, id: string): Promise<void> {
    const attachment = await this.repository.find(project, id);
    if (!attachment || attachment.status === "deleted") {
      throw new AttachmentServiceError("ATTACHMENT_NOT_FOUND", 404, "Attachment was not found");
    }
    if (attachment.status !== "ready" && attachment.status !== "deleting") {
      throw new AttachmentServiceError("ATTACHMENT_NOT_READY", 409, "Attachment cannot be deleted in its current state");
    }
    const claimToken = await this.repository.claimDeleting(id, this.now());
    if (!claimToken) {
      if (await this.repository.isReferenced(id)) {
        throw new AttachmentServiceError("ATTACHMENT_REFERENCED", 409, "Attachment is referenced by a memory revision");
      }
      throw new AttachmentServiceError("ATTACHMENT_NOT_READY", 409, "Attachment deletion changed concurrently");
    }
    try {
      await this.objectStore.delete([
        attachment.originalR2Key,
        ...(attachment.markdownR2Key ? [attachment.markdownR2Key] : []),
      ]);
    } catch {
      try {
        await this.repository.retryDelete(id, claimToken, this.now());
      } catch (retryError) {
        logCleanupFailure("attachment retryDelete", retryError);
      }
      throw new AttachmentServiceError("INTEGRITY_ERROR", 503, "Attachment object deletion is pending retry");
    }
    if ((await this.repository.markDeleted(id, claimToken, this.now())) !== 1) {
      throw new AttachmentServiceError("ATTACHMENT_NOT_READY", 409, "Attachment deletion claim was lost");
    }
  }

}
