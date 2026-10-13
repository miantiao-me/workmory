import { beforeEach, describe, expect, it } from "vitest";
import { createProfileService } from "../../server/profile/service";
import { RECORDED_AT, setField, suppressedField } from "../fixtures/profile";
import { accessActor, resetTestEnv } from "./helpers";
import { memoryService } from "./memory-service-helpers";

const service = (owner = "subject-a") => createProfileService(memoryService(accessActor(owner)), () => new Date(RECORDED_AT));

beforeEach(resetTestEnv);

describe("ProfileService merge and policy", () => {
  it("merges global and project overrides, remove, suppress, expiry, staleness, and sensitivity", async () => {
    const profiles = service();
    await profiles.update({ operations: [
      { op: "set", section: "preferences", field: "theme", fieldValue: setField("dark") },
      { op: "set", section: "preferences", field: "stale", fieldValue: setField("old", { stale_after: "2026-08-19" }) },
      { op: "set", section: "personal", field: "address", fieldValue: setField("secret", { sensitivity: "sensitive" }) },
      { op: "set", section: "preferences", field: "expired", fieldValue: setField("gone", { expires_at: "2026-08-19T09:00:00Z" }) },
    ] });
    const project = await profiles.update({ project: "workmory", operations: [
      { op: "set", section: "preferences", field: "theme", fieldValue: setField("light") },
    ] });
    expect(project.effective.preferences.theme).toMatchObject({ value: "light", origin: "project" });
    expect(project.effective.personal.address).not.toHaveProperty("value");
    expect(project.maskedFields).toEqual([{ section: "personal", field: "address" }]);
    expect(project.staleFields).toEqual([{ section: "preferences", field: "stale" }]);
    expect(project.effective.preferences.expired).toBeUndefined();
    const removed = await profiles.update({ project: "workmory", operations: [{ op: "remove", section: "preferences", field: "theme" }] });
    expect(removed.effective.preferences.theme.value).toBe("dark");
    const suppressed = await profiles.update({ project: "workmory", operations: [{
      op: "suppress", section: "preferences", field: "theme",
      fieldValue: suppressedField(),
    }] });
    expect(suppressed.effective.preferences.theme).toBeUndefined();
    expect((await profiles.get({ project: "workmory", includeSensitive: true, includeRaw: true })).effective.personal.address.value).toBe("secret");
  });

  it("preserves unknown data and enforces agent inference policy", async () => {
    const profiles = service();
    await profiles.update({ operations: [{
      op: "set", section: "future", field: "setting",
      fieldValue: setField({ enabled: true }, { future_metadata: 7 }),
    }] });
    const updated = await profiles.update({ operations: [{
      op: "set", section: "preferences", field: "editor",
      fieldValue: setField("vim", {
        provenance: { kind: "agent_inferred", source_ids: ["memory-1"], recorded_at: RECORDED_AT },
        confidence: 0.8, stale_after: "2026-12-01",
      }),
    }] });
    expect(updated.effective.future.setting).not.toHaveProperty("future_metadata");
    expect((await profiles.get({ includeSensitive: true, includeRaw: true })).raw?.global).toContain("future_metadata");
    await expect(profiles.update({ operations: [{
      op: "set", section: "secrets", field: "token",
      fieldValue: setField("x", {
        provenance: { kind: "agent_inferred", source_ids: ["memory-1"], recorded_at: RECORDED_AT },
        confidence: 0.8, stale_after: "2026-12-01",
      }),
    }] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("does not expose sensitive, expired, canonical, or unknown raw profile data from update", async () => {
    const profiles = service();
    await profiles.update({ operations: [
      { op: "set", section: "personal", field: "token", fieldValue: setField("profile-secret", {
        sensitivity: "sensitive", future_metadata: "raw-profile-secret",
        provenance: { kind: "user_explicit", recorded_at: RECORDED_AT, future_source: "raw-source-secret" },
      }) },
      { op: "set", section: "personal", field: "expired", fieldValue: setField("expired-secret", {
        sensitivity: "sensitive", expires_at: "2026-08-19T09:00:00Z",
      }) },
    ] });
    const updated = await profiles.update({ operations: [
      { op: "set", section: "preferences", field: "theme", fieldValue: setField("dark") },
    ] });
    const serialized = JSON.stringify(updated);
    expect(serialized).not.toContain("profile-secret");
    expect(serialized).not.toContain("expired-secret");
    expect(serialized).not.toContain("raw-source-secret");
    expect(serialized).not.toContain("future_metadata");
    expect(serialized).not.toContain("document");
    expect(updated.effective.preferences.theme.value).toBe("dark");
    expect(updated.effective.personal.token).not.toHaveProperty("value");
    expect(updated.effective.personal.expired).toBeUndefined();
  });

  it("maps domain timestamp validation to stable invalid input", async () => {
    await expect(service().update({ operations: [{
      op: "set", section: "preferences", field: "theme",
      fieldValue: { state: "set", value: "dark", provenance: { kind: "user_explicit", recorded_at: "2026-08-19T10:00Z" } },
    }] })).rejects.toMatchObject({ code: "INVALID_INPUT", message: "Must be an RFC3339 timestamp" });
  });
});
