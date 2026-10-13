import { describe, expect, it } from "vitest";
import { patchProfile } from "../server/profile/document";
import { mergeProfiles } from "../server/profile/merge";
import { profile, RECORDED_AT, setField, suppressedField } from "./fixtures/profile";

describe("profile merge", () => {
  it("applies project overrides and reveals global values after local removal", () => {
    const global = profile("global", { preferences: { theme: setField("dark") } });
    const project = profile("project", { preferences: { theme: setField("light") } });
    expect(mergeProfiles(global, project, { now: RECORDED_AT }).sections.preferences.theme).toMatchObject({ value: "light", origin: "project" });
    const removed = patchProfile(project, [{ op: "remove", section: "preferences", field: "theme" }]);
    expect(mergeProfiles(global, removed, { now: RECORDED_AT }).sections.preferences.theme).toMatchObject({ value: "dark", origin: "global" });
  });

  it("uses project tombstones to suppress global fields", () => {
    const global = profile("global", { preferences: { theme: setField("dark") } });
    const project = profile("project", { preferences: { theme: suppressedField() } });
    expect(mergeProfiles(global, project, { now: RECORDED_AT }).sections).toEqual({});
  });

  it("excludes expired fields, resurfaces global under expired overrides, and reports stale fields", () => {
    const global = profile("global", { preferences: {
      locale: setField("zh-CN"), stale: setField("old", { stale_after: "2026-08-19" }),
      expired: setField("gone", { expires_at: "2026-08-19T09:00:00Z" }),
    } });
    const project = profile("project", { preferences: { locale: setField("en-US", { expires_at: "2026-08-19T09:00:00Z" }) } });
    const effective = mergeProfiles(global, project, { now: RECORDED_AT });
    expect(effective.sections.preferences.locale).toMatchObject({ value: "zh-CN", origin: "global" });
    expect(effective.sections.preferences.expired).toBeUndefined();
    expect(effective.staleFields).toEqual([{ section: "preferences", field: "stale" }]);
  });

  it("masks sensitive values by default and reveals them explicitly", () => {
    const global = profile("global", { personal: { address: setField("private", { sensitivity: "sensitive" }) } });
    const masked = mergeProfiles(global, undefined, { now: RECORDED_AT });
    expect(masked.sections.personal.address).not.toHaveProperty("value");
    expect(masked.maskedFields).toEqual([{ section: "personal", field: "address" }]);
    const included = mergeProfiles(global, undefined, { now: RECORDED_AT, includeSensitive: true });
    expect(included.sections.personal.address.value).toBe("private");
    expect(included.maskedFields).toEqual([]);
  });
});
