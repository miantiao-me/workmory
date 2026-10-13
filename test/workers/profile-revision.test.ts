import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryService, OPERATION_RECEIPT_LEASE_MS } from "../../server/application/d1-memory-service";
import { createProfileService } from "../../server/profile/service";
import { enqueueSemanticReindex } from "../../server/search/outbox-processor";
import { R2ObjectStore } from "../../server/storage/r2-object-store";
import { RECORDED_AT, setField } from "../fixtures/profile";
import { accessActor, deferred, resetTestEnv, testEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";

const service = (owner = "subject-a") => createProfileService(memoryService(accessActor(owner)), () => new Date(RECORDED_AT));

beforeEach(resetTestEnv);

describe("ProfileService revisions, receipts, deletion, and indexability", () => {
  it("uses CAS and operation receipts without applying retries twice", async () => {
    const profiles = service();
    const firstRequest = {
      operationId: "profile-operation-1",
      expectedRevision: 0,
      operations: [{ op: "set" as const, section: "preferences", field: "theme", fieldValue: setField("dark") }],
    };
    const first = await profiles.update(firstRequest);
    await profiles.update({ operationId: "profile-operation-2", operations: [{
      op: "set", section: "preferences", field: "theme", fieldValue: setField("light"),
    }] });
    const replay = await profiles.update(firstRequest);
    expect(replay.target.revision).toBe(first.target.revision);
    expect((await profiles.get({})).effective.preferences.theme.value).toBe("light");
    await expect(profiles.update({ ...firstRequest, expectedRevision: 1 })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    await expect(profiles.update({ operationId: "profile-operation-1", operations: [{
      op: "set", section: "preferences", field: "locale", fieldValue: setField("zh-CN"),
    }] })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    await expect(profiles.update({ expectedRevision: 0, operations: [{
      op: "remove", section: "preferences", field: "theme",
    }] })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("returns the same project result on completed replay and merges the current global profile", async () => {
    const profiles = service();
    const global = await profiles.update({ operations: [
      { op: "set", section: "preferences", field: "locale", fieldValue: setField("en-US") },
    ] });
    const request = {
      project: "workmory",
      operationId: "project-profile-replay",
      expectedRevision: 0,
      operations: [{ op: "set" as const, section: "preferences", field: "theme", fieldValue: setField("dark") }],
    };
    const first = await profiles.update(request);
    const replay = await profiles.update(request);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      globalRevision: global.target.revision,
      projectRevision: first.target.revision,
      target: { scope: "project", project: "workmory", revision: first.target.revision },
      effective: { preferences: {
        locale: { value: "en-US", origin: "global" },
        theme: { value: "dark", origin: "project" },
      } },
    });

    const changedGlobal = await profiles.update({ operations: [
      { op: "set", section: "preferences", field: "locale", fieldValue: setField("zh-CN") },
    ] });
    const replayAfterGlobalChange = await profiles.update(request);
    expect(replayAfterGlobalChange.globalRevision).toBe(changedGlobal.target.revision);
    expect(replayAfterGlobalChange.effective.preferences.locale).toMatchObject({ value: "zh-CN", origin: "global" });
    expect(replayAfterGlobalChange.effective.preferences.theme).toMatchObject({ value: "dark", origin: "project" });
    expect(replayAfterGlobalChange.target).toEqual(first.target);
    expect(replayAfterGlobalChange.projectRevision).toBe(first.projectRevision);
  });

  it("replays a completed operation before validating an otherwise invalid patch", async () => {
    const profiles = service();
    const request = {
      operationId: "profile-invalid-replay",
      expectedRevision: 0,
      operations: [{ op: "set" as const, section: "preferences", field: "value", fieldValue: setField(null) }],
    };
    const first = await profiles.update(request);
    const invalidReplay = {
      ...request,
      operations: [{ op: "set" as const, section: "preferences", field: "value", fieldValue: setField(Number.NaN) }],
    };
    await expect(profiles.update(invalidReplay)).resolves.toEqual(first);
    await expect(profiles.update({ operations: invalidReplay.operations })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("replays a completed update before patching a full profile", async () => {
    const profiles = service();
    const request = {
      operationId: "profile-full-replay",
      expectedRevision: 0,
      operations: [{ op: "set" as const, section: "replay", field: "original", fieldValue: setField("done") }],
    };
    const first = await profiles.update(request);
    await profiles.update({ operations: [
      { op: "remove", section: "replay", field: "original" },
      ...Array.from({ length: 63 }, (_, index) => ({
        op: "set" as const, section: "full", field: `field${index}`, fieldValue: setField(index),
      })),
    ] });
    for (let start = 63; start < 255; start += 64) {
      await profiles.update({ operations: Array.from({ length: 64 }, (_, offset) => ({
        op: "set" as const, section: "full", field: `field${start + offset}`, fieldValue: setField(start + offset),
      })) });
    }
    await profiles.update({ operations: [{ op: "set", section: "full", field: "field255", fieldValue: setField(255) }] });
    expect(Object.keys((await profiles.get({})).effective.full)).toHaveLength(256);
    await expect(profiles.update(request)).resolves.toMatchObject({ target: { revision: first.target.revision } });
  });

  it("replays a completed update when the current profile is near its size limit", async () => {
    const profiles = service();
    const request = {
      operationId: "profile-large-replay",
      expectedRevision: 0,
      operations: [{ op: "set" as const, section: "replay", field: "original", fieldValue: setField("done") }],
    };
    const first = await profiles.update(request);
    await profiles.update({ operations: [
      { op: "remove", section: "replay", field: "original" },
      { op: "set", section: "large", field: "value", fieldValue: setField("x".repeat(250_000)) },
    ] });
    expect((await profiles.get({ includeSensitive: true, includeRaw: true })).raw?.global?.length).toBeGreaterThan(250_000);
    await expect(profiles.update(request)).resolves.toMatchObject({ target: { revision: first.target.revision } });
  });

  it("logically deletes profiles and preserves owner/root isolation", async () => {
    const owner = service();
    const created = await owner.update({ operations: [{ op: "set", section: "preferences", field: "theme", fieldValue: setField("dark") }] });
    expect((await service("subject-b").get({})).effective).toEqual({});
    const root = createProfileService(memoryService({ ownerId: "root", actorId: "root-key", authKind: "root" }));
    expect((await root.get({})).effective).toEqual({});
    const deleted = await owner.delete({ expectedRevision: created.target.revision, operationId: "profile-delete-1" });
    expect(deleted.deleted).toBe(true);
    expect((await owner.get({})).effective).toEqual({});
    await expect(owner.delete({})).rejects.toMatchObject({ code: "NOT_FOUND" });
    const recreated = await owner.update({ expectedRevision: deleted.revision, operations: [
      { op: "set", section: "preferences", field: "theme", fieldValue: setField("new") },
    ] });
    const replay = await owner.delete({ expectedRevision: created.target.revision, operationId: "profile-delete-1" });
    expect(replay).toEqual(deleted);
    expect((await owner.get({})).effective.preferences.theme.value).toBe("new");
    await expect(owner.delete({ expectedRevision: recreated.target.revision, operationId: "profile-delete-1" }))
      .rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    await expect(owner.delete({ expectedRevision: created.target.revision })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("keeps the original expected revision when taking over an expired profile claim", async () => {
    let now = 1_000;
    const entered = deferred();
    const crash = deferred();
    const objects = new R2ObjectStore(testEnv.BUCKET);
    let puts = 0;
    const memory = createMemoryService({ DB: testEnv.DB, BUCKET: testEnv.BUCKET }, accessActor("subject-a"), {
      now: () => now,
      objectStore: {
        getOkf: (key, hash) => objects.getOkf(key, hash),
        async putOkf(key, markdown, hash) {
          puts += 1;
          if (puts === 1) {
            entered.resolve();
            await crash.promise;
            throw new Error("simulated profile crash");
          }
          await objects.putOkf(key, markdown, hash);
        },
      },
    });
    const profiles = createProfileService(memory, () => new Date(RECORDED_AT));
    const request = {
      operationId: "profile-takeover",
      expectedRevision: 0,
      operations: [{ op: "set" as const, section: "preferences", field: "theme", fieldValue: setField("dark") }],
    };
    const first = profiles.update(request);
    await entered.promise;
    await testEnv.DB.prepare("UPDATE operation_receipts SET claim_token = 'crashed-profile-claim' WHERE operation_id = ?")
      .bind(request.operationId).run();
    crash.resolve();
    await expect(first).rejects.toThrow("simulated profile crash");
    await profiles.update({ expectedRevision: 0, operations: [
      { op: "set", section: "preferences", field: "theme", fieldValue: setField("new") },
    ] });
    now += OPERATION_RECEIPT_LEASE_MS + 1;
    await expect(profiles.update(request)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await profiles.get({})).effective.preferences.theme.value).toBe("new");
  });

  it("never creates derived index data or maintenance reindex work", async () => {
    await service().update({ operations: [{ op: "set", section: "preferences", field: "theme", fieldValue: setField("dark") }] });
    const counts = await testEnv.DB.prepare(`SELECT
      (SELECT count(*) FROM memory_tags) AS tags,
      (SELECT count(*) FROM memory_search_docs) AS docs,
      (SELECT count(*) FROM index_outbox) AS outbox,
      (SELECT count(*) FROM semantic_vectors) AS vectors`).first();
    expect(counts).toEqual({ tags: 0, docs: 0, outbox: 0, vectors: 0 });
    expect(await enqueueSemanticReindex(testEnv.DB)).toEqual({ enqueued: 0 });
  });
});
