import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryService } from "../../server/application/d1-memory-service";
import { accessActor, resetTestEnv, testEnv } from "./helpers";
import { attachmentCleanup, attachmentService, FakeConverter, text } from "./attachment-fixtures";
import { AttachmentService } from "../../server/attachments/service";
import { R2AttachmentObjectStore, type AttachmentObjectStore } from "../../server/storage/attachment-object-store";

beforeEach(resetTestEnv);

describe("attachment deletion and cleanup", () => {
  it("fences explicit deletion completion after a replacement claim", async () => {
    const ready = await attachmentService().service.upload({
      project: "workmory", filename: "explicit-fence.txt", body: text("body"), idempotencyKey: "explicit-fence",
    });
    const stored = new R2AttachmentObjectStore(testEnv.BUCKET);
    const racingStore: AttachmentObjectStore = {
      put: (key, bytes, sha256, contentType) => stored.put(key, bytes, sha256, contentType),
      get: (key, sha256) => stored.get(key, sha256),
      async delete(keys) {
        await testEnv.DB.prepare(
          "UPDATE attachments SET delete_claim_token = 'replacement-explicit-claim', delete_claimed_at = ? WHERE id = ?",
        ).bind(Date.now(), ready.id).run();
        await stored.delete(keys);
      },
    };
    const service = new AttachmentService(testEnv.DB, racingStore, new FakeConverter(), accessActor());
    await expect(service.delete("workmory", ready.id)).rejects.toMatchObject({ code: "ATTACHMENT_NOT_READY" });
    expect(await testEnv.DB.prepare("SELECT status, delete_claim_token AS token FROM attachments WHERE id = ?").bind(ready.id).first())
      .toEqual({ status: "deleting", token: "replacement-explicit-claim" });
  });

  it("does not expose an attachment while deletion is in progress", async () => {
    const attachments = attachmentService().service;
    const ready = await attachments.upload({ project: "workmory", filename: "deleting.txt", body: text("body"), idempotencyKey: "deleting" });
    await testEnv.DB.prepare("UPDATE attachments SET status = 'deleting' WHERE id = ?").bind(ready.id).run();
    await expect(attachments.getMetadata("workmory", ready.id)).rejects.toMatchObject({ code: "ATTACHMENT_NOT_READY", status: 409 });
    await expect(attachments.resolve("workmory", ready.id)).rejects.toMatchObject({ code: "ATTACHMENT_NOT_READY" });
  });

  it("blocks deletion while referenced and cleans quarantined failures", async () => {
    const attachments = attachmentService().service;
    const ready = await attachments.upload({ project: "workmory", filename: "linked.md", body: text("linked"), idempotencyKey: "linked" });
    const memory = createMemoryService({ DB: testEnv.DB, BUCKET: testEnv.BUCKET }, accessActor(), { attachments });
    await memory.store({ project: "workmory", namespace: "default", key: "with/attachment", source: { attachment_id: ready.id } });
    await expect(attachments.delete("workmory", ready.id)).rejects.toMatchObject({ code: "ATTACHMENT_REFERENCED", status: 409 });

    const doomed = await attachments.upload({ project: "workmory", filename: "doomed.txt", body: text("doomed"), idempotencyKey: "doomed" });
    await testEnv.DB.prepare("UPDATE attachments SET status = 'processing', updated_at = 0 WHERE id = ?").bind(doomed.id).run();
    const cleanup = attachmentCleanup();
    const marked = await cleanup.cleanupStale(Date.now());
    expect(marked).toMatchObject({ markedFailed: 1, deleted: 0 });
    await testEnv.DB.prepare("UPDATE attachments SET quarantine_at = 0 WHERE id = ?").bind(doomed.id).run();
    expect((await cleanup.cleanupStale(Date.now())).deleted).toBe(1);
  });

  it("runs maintenance cleanup across attachment owners", async () => {
    const first = await attachmentService({ ownerId: "subject-a" }).service.upload({
      project: "workmory", filename: "owner-a.txt", body: text("a"), idempotencyKey: "cleanup-a",
    });
    const second = await attachmentService({ ownerId: "subject-b" }).service.upload({
      project: "workmory", filename: "owner-b.txt", body: text("b"), idempotencyKey: "cleanup-b",
    });
    await testEnv.DB.prepare("UPDATE attachments SET status = 'processing', updated_at = 0 WHERE id IN (?, ?)")
      .bind(first.id, second.id).run();
    const cleanup = attachmentCleanup();
    expect(await cleanup.cleanupStale(Date.now())).toMatchObject({ markedFailed: 2, deleted: 0 });
    await testEnv.DB.prepare("UPDATE attachments SET quarantine_at = 0 WHERE id IN (?, ?)").bind(first.id, second.id).run();
    expect((await cleanup.cleanupStale(Date.now())).deleted).toBe(2);
  });
});
