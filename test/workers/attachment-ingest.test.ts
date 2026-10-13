import { beforeEach, describe, expect, it } from "vitest";
import { AttachmentRepository } from "../../server/attachments/attachment-repository";
import { MAX_ATTACHMENT_BYTES } from "../../server/attachments/types";
import { projectOpaqueId } from "../../server/domain/identity";
import type { AttachmentObjectStore } from "../../server/storage/attachment-object-store";
import { accessActor, resetTestEnv, testEnv } from "./helpers";
import { attachmentIngestor, attachmentService, FakeConverter, pdfInput, text } from "./attachment-fixtures";

beforeEach(resetTestEnv);

describe("attachment ingest invariants", () => {
  it("accepts exactly 8 MiB and stops at 8 MiB + 1", async () => {
    const { service } = attachmentService();
    const exact = new Uint8Array(MAX_ATTACHMENT_BYTES).fill(0x61);
    exact.set(text("%PDF-1.7"));
    await expect(
      service.upload({ project: "workmory", filename: "large.pdf", declaredMime: "application/pdf", body: exact, idempotencyKey: "large-exact" }),
    ).resolves.toMatchObject({ originalSize: MAX_ATTACHMENT_BYTES, status: "ready" });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_ATTACHMENT_BYTES).fill(0x61));
        controller.enqueue(new Uint8Array([0x61]));
        controller.close();
      },
    });
    await expect(
      service.upload({ project: "workmory", filename: "too-large.txt", body: stream, idempotencyKey: "large-plus-one" }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("does not trust missing or false Content-Length and verifies expected hashes", async () => {
    const { service } = attachmentService();
    const body = text("plain text body");
    await expect(service.upload({ project: "workmory", filename: "note.txt", body, idempotencyKey: "missing-length" }))
      .resolves.toMatchObject({ status: "ready" });
    await expect(service.upload({ project: "workmory", filename: "false.txt", body, contentLength: 1, idempotencyKey: "false-length" }))
      .resolves.toMatchObject({ originalSize: body.byteLength });
    await expect(service.upload({ project: "workmory", filename: "hash.txt", body, expectedSha256: "00", idempotencyKey: "bad-hash" }))
      .rejects.toMatchObject({ code: "HASH_MISMATCH" });
  });

  it("does not start an R2 side effect after the absolute deadline", async () => {
    let puts = 0;
    const objectStore: AttachmentObjectStore = {
      async put() { puts += 1; },
      async get() { return null; },
      async delete() {},
    };
    const repository = new AttachmentRepository(testEnv.DB, accessActor());
    const ingestor = attachmentIngestor({ repository, objectStore, now: () => 1_000 });
    await expect(ingestor.ingestAttachment(pdfInput({
      filename: "deadline.pdf",
      idempotencyKey: "deadline-before-r2",
      sourceKind: "url",
      fingerprintOverride: "deadline-fingerprint",
      deadlineAt: 1_000,
    }))).rejects.toMatchObject({ code: "REMOTE_TIMEOUT" });
    expect(puts).toBe(0);
  });

  it("returns ready when the deadline crosses during the ready commit", async () => {
    let now = 999;
    class DeadlineCrossingRepository extends AttachmentRepository {
      override async markReady(id: string, committedAt: number): Promise<boolean> {
        const committed = await super.markReady(id, committedAt);
        now = 1_000;
        return committed;
      }
    }
    const ingestor = attachmentIngestor({
      repository: new DeadlineCrossingRepository(testEnv.DB, accessActor()),
      now: () => now,
    });

    await expect(ingestor.ingestAttachment(pdfInput({
      filename: "deadline-commit.pdf",
      idempotencyKey: "deadline-crosses-commit",
      sourceKind: "url",
      fingerprintOverride: "deadline-crosses-commit-fingerprint",
      deadlineAt: 1_000,
    }))).resolves.toMatchObject({ status: "ready" });
  });

  it("does not let markFailed move a ready attachment backwards", async () => {
    const ready = await attachmentService().service.upload({
      project: "workmory",
      filename: "stays-ready.txt",
      body: text("ready"),
      idempotencyKey: "stays-ready",
    });
    const repository = new AttachmentRepository(testEnv.DB, accessActor());

    await expect(repository.markFailed(ready.id, "REMOTE_TIMEOUT", 2_000, 3_000)).resolves.toBe(false);
    await expect(attachmentService().service.getMetadata("workmory", ready.id)).resolves.toMatchObject({ status: "ready" });
  });

  it("bypasses AI for Markdown, enforces MIME/magic, and uses opaque R2 keys", async () => {
    const { service, converter } = attachmentService();
    const ready = await service.upload({
      project: "workmory",
      filename: "secret-name.md",
      declaredMime: "text/markdown",
      body: text("# Note"),
      idempotencyKey: "markdown-bypass",
    });
    expect(converter.calls).toBe(0);
    const attachment = await testEnv.DB.prepare(
      `SELECT original_r2_key AS originalKey, markdown_r2_key AS markdownKey,
              original_sha256 AS originalHash, markdown_sha256 AS markdownHash
       FROM attachments WHERE id = ?`,
    ).bind(ready.id).first<Record<string, unknown>>();
    const expectedHash = "60930edd1bf299c7f8df7f3a1b4e85c6f46c04daefe6a23910a624740ae1d366";
    const prefix = `attachments/prj_961fdb7e5543c6fb88da2858601083c5/${ready.id}`;
    expect(attachment).toMatchObject({
      originalKey: `${prefix}/original/${expectedHash}`,
      markdownKey: `${prefix}/markdown/${expectedHash}`,
      originalHash: expectedHash,
      markdownHash: expectedHash,
    });
    await expect(
      service.upload({ project: "workmory", filename: "fake.png", declaredMime: "image/png", body: text("not png"), idempotencyKey: "bad-magic" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
  });

  it("implements actor/project idempotency and isolation", async () => {
    const firstService = attachmentService().service;
    const input = { project: "workmory", filename: "note.txt", body: text("same"), idempotencyKey: "idem-key" };
    const first = await firstService.upload(input);
    await expect(firstService.upload(input)).resolves.toMatchObject({ id: first.id, reused: true });
    await expect(firstService.upload({ ...input, body: text("different") })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(attachmentService({ ownerId: "subject-b" }).service.getMetadata("workmory", first.id)).rejects.toMatchObject({
      code: "ATTACHMENT_NOT_FOUND",
    });
    await expect(firstService.getMetadata("other-project", first.id)).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  it("reports whether the targeted idempotency insert won", async () => {
    const repository = new AttachmentRepository(testEnv.DB, accessActor());
    const projectId = await projectOpaqueId("subject-a", "workmory");
    const input = {
      projectId,
      project: "workmory",
      sourceKind: "upload" as const,
      filename: "race.txt",
      detectedMime: "text/plain",
      originalSize: 4,
      originalSha256: "hash",
      originalR2Key: "attachments/race/original",
      idempotencyKey: "race-key",
      fingerprint: "same-fingerprint",
      now: 1,
    };

    await expect(repository.insertProcessing({ ...input, id: "att_race_winner" })).resolves.toBe(true);
    await expect(repository.insertProcessing({ ...input, id: "att_race_loser" })).resolves.toBe(false);
    await expect(repository.existingResult(projectId, input.idempotencyKey, input.fingerprint, input.project))
      .rejects.toMatchObject({ code: "ATTACHMENT_PROCESSING" });
    await expect(repository.existingResult(projectId, input.idempotencyKey, "different-fingerprint", input.project))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rejects a real primary-key conflict outside the targeted idempotency constraint", async () => {
    const repository = new AttachmentRepository(testEnv.DB, accessActor());
    const projectId = await projectOpaqueId("subject-a", "workmory");
    const input = {
      id: "att_duplicate_primary_key",
      projectId,
      project: "workmory",
      sourceKind: "upload" as const,
      filename: "first.txt",
      detectedMime: "text/plain",
      originalSize: 5,
      originalSha256: "first-hash",
      originalR2Key: "attachments/primary-key/original",
      idempotencyKey: "primary-key-first",
      fingerprint: "first-fingerprint",
      now: 1,
    };

    await expect(repository.insertProcessing(input)).resolves.toBe(true);
    await expect(repository.insertProcessing({
      ...input,
      filename: "second.txt",
      originalSha256: "second-hash",
      originalR2Key: "attachments/primary-key/second-original",
      idempotencyKey: "primary-key-second",
      fingerprint: "second-fingerprint",
      now: 2,
    })).rejects.toBeDefined();

    await expect(repository.findByIdempotency(projectId, "primary-key-second")).resolves.toBeNull();
    await expect(repository.findByIdempotency(projectId, "primary-key-first")).resolves.toMatchObject({
      id: input.id,
      filename: input.filename,
      originalSha256: input.originalSha256,
    });
  });

  it("propagates non-idempotency database failures unchanged", async () => {
    const failure = new Error("database unavailable");
    const db = new Proxy(testEnv.DB, {
      get(target, property) {
        if (property === "batch") return async () => { throw failure; };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const ingestor = attachmentIngestor({
      repository: new AttachmentRepository(db, accessActor()),
      now: Date.now,
    });

    await expect(ingestor.ingestAttachment(pdfInput({
      filename: "db-failure.txt",
      declaredMime: undefined,
      bytes: text("body"),
      idempotencyKey: "db-failure",
    }))).rejects.toBe(failure);
  });

  it("checks R2 integrity and hides failed attachments", async () => {
    const converter = new FakeConverter();
    converter.fail = true;
    const { service } = attachmentService({ converter });
    await expect(
      service.upload({ project: "workmory", filename: "report.pdf", declaredMime: "application/pdf", body: text("%PDF-1.7 fixture"), idempotencyKey: "failed-conversion" }),
    ).rejects.toMatchObject({ code: "CONVERSION_FAILED" });
    const failed = await testEnv.DB.prepare("SELECT id FROM attachments").first<{ id: string }>();
    await expect(service.getMetadata("workmory", failed!.id)).rejects.toMatchObject({ code: "ATTACHMENT_FAILED" });

    const healthy = await attachmentService().service.upload({ project: "workmory", filename: "healthy.txt", body: text("healthy"), idempotencyKey: "healthy" });
    const object = await testEnv.DB.prepare("SELECT original_r2_key AS key FROM attachments WHERE id = ?").bind(healthy.id).first<{ key: string }>();
    await testEnv.BUCKET.put(object!.key, "corrupt", { customMetadata: { sha256: "wrong" } });
    await expect(attachmentService().service.getOriginal("workmory", healthy.id)).rejects.toMatchObject({
      code: "INTEGRITY_ERROR",
      status: 500,
      message: "Attachment object integrity validation failed",
    });
  });
});
