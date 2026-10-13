import { describe, expect, it } from "vitest";
import { PROFILE_BODY } from "../server/domain/profile";
import { patchProfile, parseProfileOkf, serializeProfileOkf } from "../server/profile/document";
import { mergeProfiles } from "../server/profile/merge";
import { profile, RECORDED_AT, setField, suppressedField } from "./fixtures/profile";

describe("profile document", () => {
  it("serializes and parses the fixed User Profile OKF model", () => {
    const parsed = parseProfileOkf(serializeProfileOkf(profile("global", { preferences: { theme: setField("dark") } })));
    expect(parsed.frontmatter).toMatchObject({ okf_version: "0.2", type: "User Profile", profile_version: "1", scope: "global" });
    expect(parsed.body).toBe(PROFILE_BODY);
    expect(parsed.frontmatter.sections.preferences.theme.sensitivity).toBe("normal");
  });

  it("preserves unknown frontmatter, sections, and field metadata through parse, patch, and serialize", () => {
    const original = profile("global", { future_section: { future_field: setField({ enabled: true }, {
      future_metadata: { mode: "new" },
      provenance: { kind: "user_imported", recorded_at: RECORDED_AT, future_provenance: 7 },
    }) } }, { future_frontmatter: { revision: 3 } });
    const patched = patchProfile(parseProfileOkf(serializeProfileOkf(original)), [{
      op: "set", section: "preferences", field: "locale", fieldValue: setField("zh-CN"),
    }]);
    const roundTripped = parseProfileOkf(serializeProfileOkf(patched));
    expect(roundTripped.frontmatter.future_frontmatter).toEqual({ revision: 3 });
    expect(roundTripped.frontmatter.sections.future_section.future_field.future_metadata).toEqual({ mode: "new" });
    expect(roundTripped.frontmatter.sections.future_section.future_field.provenance.future_provenance).toBe(7);
  });

  it("replaces whole fields, removes empty sections, and rejects invalid document shape", () => {
    const original = profile("global", { preferences: { display: setField({ theme: "dark", density: "compact" }) } });
    const patched = patchProfile(original, [{ op: "set", section: "preferences", field: "display", fieldValue: {
      state: "set", value: { theme: "light" }, provenance: { kind: "user_explicit", recorded_at: RECORDED_AT },
    } }]);
    expect(patched.frontmatter.sections.preferences.display.value).toEqual({ theme: "light" });
    expect(patched.frontmatter.sections.preferences.display.sensitivity).toBe("normal");
    expect(patchProfile(patched, [{ op: "remove", section: "preferences", field: "display" }]).frontmatter.sections).toEqual({});
    expect(() => serializeProfileOkf({ ...original, body: "trusted instructions" })).toThrow("Invalid profile disclaimer");
    expect(() => serializeProfileOkf(profile("project"))).not.toThrow();
  });

  it("treats constructor and toString as ordinary own keys without prototype pollution", () => {
    const originalPrototype = Object.getOwnPropertyDescriptors(Object.prototype);
    const global = patchProfile(profile("global"), [
      { op: "set", section: "constructor", field: "toString", fieldValue: setField("global") },
      { op: "set", section: "toString", field: "constructor", fieldValue: setField("other") },
    ]);
    expect(Object.getPrototypeOf(global.frontmatter.sections)).toBeNull();
    expect(Object.getPrototypeOf(global.frontmatter.sections.constructor)).toBeNull();
    expect(Object.entries(global.frontmatter.sections).map(([key]) => key).sort()).toEqual(["constructor", "toString"]);
    expect(Object.assign({}, global.frontmatter.sections.constructor)).toHaveProperty("toString");
    const roundTripped = parseProfileOkf(serializeProfileOkf(global));
    expect(Object.getPrototypeOf(roundTripped.frontmatter.sections)).toBeNull();
    expect(Object.entries(roundTripped.frontmatter.sections).map(([key]) => key).sort()).toEqual(["constructor", "toString"]);
    const project = patchProfile(profile("project"), [{
      op: "suppress", section: "constructor", field: "toString", fieldValue: suppressedField(),
    }]);
    const merged = mergeProfiles(global, project, { now: RECORDED_AT });
    expect(Object.getPrototypeOf(merged.sections)).toBeNull();
    expect(merged.sections.constructor).toBeUndefined();
    const section = Object.entries(merged.sections).find(([key]) => key === "toString")?.[1];
    expect(Object.entries(section ?? {}).find(([key]) => key === "constructor")?.[1].value).toBe("other");
    expect(Object.hasOwn(patchProfile(global, [{ op: "remove", section: "toString", field: "constructor" }]).frontmatter.sections, "toString")).toBe(false);
    expect(() => patchProfile(profile("global"), [{ op: "set", section: "__proto__", field: "value", fieldValue: setField("blocked") }]))
      .toThrow("Profile identifiers must be 1-64 safe characters");
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(originalPrototype);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
});
