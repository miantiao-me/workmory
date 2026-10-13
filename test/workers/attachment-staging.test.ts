import { beforeEach, describe, expect, it } from "vitest";
import { AttachmentCleanup } from "../../server/attachments/attachment-cleanup";
import { AttachmentRepository } from "../../server/attachments/attachment-repository";
import { R2AttachmentObjectStore, type AttachmentObjectStore } from "../../server/storage/attachment-object-store";
import { accessActor, resetTestEnv, testEnv } from "./helpers";
import {
  attachmentCleanup,
  attachmentIngestor,
  pdfInput,
} from "./attachment-fixtures";

beforeEach(resetTestEnv);

describe("attachment object staging", () => {
  it("stages Markdown before its put and lets cleanup remove it after a lost ready CAS", async () => {
    const stored = new R2AttachmentObjectStore(testEnv.BUCKET);
    let puts = 0;
    let markdownKey: string | undefined;
    const racingStore: AttachmentObjectStore = {
      async put(key, bytes, sha256, contentType) {
        await stored.put(key, bytes, sha256, contentType);
        puts += 1;
        if (puts === 2) {
          markdownKey = key;
          expect(await testEnv.DB.prepare(
            "SELECT markdown_r2_key AS markdownKey, markdown_sha256 AS markdownSha256, markdown_size AS markdownSize FROM attachments",
          ).first()).toMatchObject({ markdownKey: key, markdownSha256: sha256, markdownSize: bytes.byteLength });
          await testEnv.DB.prepare(
            "UPDATE attachments SET status = 'failed', error_code = 'PROCESSING_TIMEOUT', quarantine_at = ?, updated_at = ? WHERE status = 'processing'",
          ).bind(0, 1_000).run();
        }
      },
      get: (key, expectedSha256) => stored.get(key, expectedSha256),
      delete: (keys) => stored.delete(keys),
    };
    const ingestor = attachmentIngestor({ objectStore: racingStore });

    await expect(ingestor.ingestAttachment(pdfInput({
      filename: "cleanup-race.pdf",
      idempotencyKey: "cleanup-race",
    }))).rejects.toMatchObject({ code: "ATTACHMENT_NOT_READY", status: 409 });

    const record = await testEnv.DB.prepare(
      "SELECT status, error_code AS errorCode, original_r2_key AS originalKey FROM attachments",
    ).first<{ status: string; errorCode: string; originalKey: string }>();
    expect(record).toMatchObject({ status: "failed", errorCode: "PROCESSING_TIMEOUT" });
    expect(markdownKey).toBeDefined();
    expect(await testEnv.BUCKET.head(markdownKey!)).not.toBeNull();
    expect(await testEnv.BUCKET.head(record!.originalKey)).not.toBeNull();
    expect((await attachmentCleanup().cleanupStale(2_000)).deleted).toBe(1);
    expect(await testEnv.BUCKET.head(markdownKey!)).toBeNull();
    expect(await testEnv.BUCKET.head(record!.originalKey)).toBeNull();
  });

  it("keeps a staged key after put failure and retries failed cleanup deletion", async () => {
    const stored = new R2AttachmentObjectStore(testEnv.BUCKET);
    let puts = 0;
    let deletes = 0;
    const failingStore: AttachmentObjectStore = {
      async put(key, bytes, sha256, contentType) {
        puts += 1;
        if (puts === 2) throw new Error("markdown put failed");
        await stored.put(key, bytes, sha256, contentType);
      },
      get: (key, expectedSha256) => stored.get(key, expectedSha256),
      async delete(keys) {
        deletes += 1;
        if (deletes === 1) throw new Error("transient delete failure");
        await stored.delete(keys);
      },
    };
    const ingestor = attachmentIngestor({ objectStore: failingStore });

    await expect(ingestor.ingestAttachment(pdfInput({
      filename: "failed-put.pdf",
      idempotencyKey: "failed-markdown-put",
    }))).rejects.toMatchObject({ code: "INTEGRITY_ERROR", status: 503, message: "Attachment storage is unavailable" });

    const record = await testEnv.DB.prepare(
      "SELECT id, status, original_r2_key AS originalKey, markdown_r2_key AS markdownKey FROM attachments",
    ).first<{ id: string; status: string; originalKey: string; markdownKey: string }>();
    expect(record).toMatchObject({ status: "failed" });
    expect(record!.markdownKey).toContain(`/markdown/`);
    await testEnv.DB.prepare("UPDATE attachments SET quarantine_at = 0 WHERE id = ?").bind(record!.id).run();

    const cleanup = new AttachmentCleanup(testEnv.DB, failingStore);
    expect((await cleanup.cleanupStale(2_000)).deleted).toBe(0);
    expect(await testEnv.BUCKET.head(record!.originalKey)).not.toBeNull();
    expect((await cleanup.cleanupStale(4_000)).deleted).toBe(1);
    expect(await testEnv.BUCKET.head(record!.originalKey)).toBeNull();
  });

  it("keeps staged objects recoverable when the deadline expires after Markdown put", async () => {
    const stored = new R2AttachmentObjectStore(testEnv.BUCKET);
    let now = 500;
    let puts = 0;
    const expiringStore: AttachmentObjectStore = {
      async put(key, bytes, sha256, contentType) {
        await stored.put(key, bytes, sha256, contentType);
        puts += 1;
        if (puts === 2) now = 1_000;
      },
      get: (key, expectedSha256) => stored.get(key, expectedSha256),
      delete: (keys) => stored.delete(keys),
    };
    const ingestor = attachmentIngestor({ objectStore: expiringStore, now: () => now });

    await expect(ingestor.ingestAttachment(pdfInput({
      filename: "expired-put.pdf",
      idempotencyKey: "expired-markdown-put",
      sourceKind: "url",
      deadlineAt: 1_000,
    }))).rejects.toMatchObject({ code: "REMOTE_TIMEOUT" });

    const record = await testEnv.DB.prepare(
      "SELECT id, status, markdown_r2_key AS markdownKey FROM attachments",
    ).first<{ id: string; status: string; markdownKey: string }>();
    expect(record).toMatchObject({ status: "failed" });
    expect(await testEnv.BUCKET.head(record!.markdownKey)).not.toBeNull();
    await testEnv.DB.prepare("UPDATE attachments SET quarantine_at = 0 WHERE id = ?").bind(record!.id).run();
    expect((await attachmentCleanup().cleanupStale(2_000)).deleted).toBe(1);
    expect(await testEnv.BUCKET.head(record!.markdownKey)).toBeNull();
  });

  it("keeps a staged Markdown object recoverable when markReady throws", async () => {
    class ThrowingRepository extends AttachmentRepository {
      override async markReady(): Promise<boolean> {
        throw new Error("D1 unavailable");
      }
    }
    const ingestor = attachmentIngestor({ repository: new ThrowingRepository(testEnv.DB, accessActor()) });

    await expect(ingestor.ingestAttachment(pdfInput({
      filename: "ready-error.pdf",
      idempotencyKey: "ready-error",
    }))).rejects.toMatchObject({ code: "INTEGRITY_ERROR", status: 503, message: "Attachment infrastructure is unavailable" });

    const record = await testEnv.DB.prepare(
      "SELECT id, status, markdown_r2_key AS markdownKey FROM attachments",
    ).first<{ id: string; status: string; markdownKey: string }>();
    expect(record).toMatchObject({ status: "failed" });
    expect(await testEnv.BUCKET.head(record!.markdownKey)).not.toBeNull();
    await testEnv.DB.prepare("UPDATE attachments SET quarantine_at = 0 WHERE id = ?").bind(record!.id).run();
    expect((await attachmentCleanup().cleanupStale(2_000)).deleted).toBe(1);
    expect(await testEnv.BUCKET.head(record!.markdownKey)).toBeNull();
  });

  it("does not put Markdown when staging loses its processing CAS", async () => {
    class LostStageRepository extends AttachmentRepository {
      override async stageMarkdown(): Promise<boolean> {
        await testEnv.DB.prepare(
          "UPDATE attachments SET status = 'failed', error_code = 'PROCESSING_TIMEOUT', quarantine_at = 0 WHERE status = 'processing'",
        ).run();
        return false;
      }
    }
    let puts = 0;
    const stored = new R2AttachmentObjectStore(testEnv.BUCKET);
    const objectStore: AttachmentObjectStore = {
      async put(key, bytes, sha256, contentType) {
        puts += 1;
        await stored.put(key, bytes, sha256, contentType);
      },
      get: (key, expectedSha256) => stored.get(key, expectedSha256),
      delete: (keys) => stored.delete(keys),
    };
    const ingestor = attachmentIngestor({
      repository: new LostStageRepository(testEnv.DB, accessActor()),
      objectStore,
    });

    await expect(ingestor.ingestAttachment(pdfInput({
      filename: "lost-stage.pdf",
      idempotencyKey: "lost-stage",
    }))).rejects.toMatchObject({ code: "ATTACHMENT_NOT_READY", status: 409 });
    expect(puts).toBe(1);
  });

  it("does not delete a ready object when a ready result is reported as lost", async () => {
    class CommittedRepository extends AttachmentRepository {
      override async markReady(id: string, now: number): Promise<boolean> {
        await super.markReady(id, now);
        return false;
      }
    }
    const stored = new R2AttachmentObjectStore(testEnv.BUCKET);
    const ingestor = attachmentIngestor({
      repository: new CommittedRepository(testEnv.DB, accessActor()),
      objectStore: stored,
    });

    await expect(ingestor.ingestAttachment(pdfInput({
      filename: "committed-ready.pdf",
      idempotencyKey: "committed-ready",
    }))).rejects.toMatchObject({ code: "ATTACHMENT_NOT_READY" });

    const record = await testEnv.DB.prepare(
      "SELECT status, markdown_r2_key AS markdownKey FROM attachments",
    ).first<{ status: string; markdownKey: string }>();
    expect(record?.status).toBe("ready");
    expect(await testEnv.BUCKET.head(record!.markdownKey)).not.toBeNull();
    expect((await attachmentCleanup().cleanupStale(100_000_000)).deleted).toBe(0);
    expect(await testEnv.BUCKET.head(record!.markdownKey)).not.toBeNull();
  });

});
