import { describe, expect, it } from "vitest";
import { patchProfile, serializeProfileOkf } from "../server/profile/document";
import { MAX_PROFILE_BYTES, ProfileValidationError } from "../server/profile/schema";
import type { ProfilePatchOperation } from "../server/profile/types";
import { profile, RECORDED_AT, setField, suppressedField } from "./fixtures/profile";

describe("profile patch policy", () => {
  it("allows valid agent inference", () => {
    const patched = patchProfile(profile("global"), [{ op: "set", section: "preferences", field: "editor", fieldValue: setField("vim", {
      provenance: { kind: "agent_inferred", source_ids: ["memory-1"], recorded_at: RECORDED_AT }, confidence: 0.8, stale_after: "2026-12-01",
    }) }]);
    expect(patched.frontmatter.sections.preferences.editor.value).toBe("vim");
  });

  it("requires confidence, source ids, and stale date for agent inference", () => {
    const base = setField("vim", {
      provenance: { kind: "agent_inferred", source_ids: ["memory-1"], recorded_at: RECORDED_AT }, confidence: 0.8, stale_after: "2026-12-01",
    });
    for (const fieldValue of [{ ...base, confidence: undefined }, { ...base, provenance: { ...base.provenance, source_ids: [] } }, { ...base, stale_after: undefined }]) {
      expect(() => patchProfile(profile("global"), [{ op: "set", section: "preferences", field: "editor", fieldValue }])).toThrow(ProfileValidationError);
    }
  });

  it("blocks sensitive and normalized high-risk agent inference sections", () => {
    const inferred = setField("value", {
      provenance: { kind: "agent_inferred", source_ids: ["memory-1"], recorded_at: RECORDED_AT }, confidence: 0.7, stale_after: "2026-12-01",
    });
    expect(() => patchProfile(profile("global"), [{ op: "set", section: "preferences", field: "private", fieldValue: { ...inferred, sensitivity: "sensitive" } }]))
      .toThrow("Agent-inferred fields cannot be sensitive");
    for (const section of ["Authenti-cation", "secrets", "HEALTH", "politics", "religion", "finance", "bio_metric"]) {
      expect(() => patchProfile(profile("global"), [{ op: "set", section, field: "inferred", fieldValue: inferred }]))
        .toThrow("Agent inference is not allowed for this section");
    }
  });

  it("allows suppression only for project scope and rejects duplicate paths", () => {
    expect(() => patchProfile(profile("global"), [{ op: "suppress", section: "preferences", field: "theme", fieldValue: suppressedField() }]))
      .toThrow("Suppress is only allowed in project scope");
    expect(patchProfile(profile("project"), [{ op: "suppress", section: "preferences", field: "theme", fieldValue: suppressedField() }])
      .frontmatter.sections.preferences.theme.state).toBe("suppressed");
    expect(() => patchProfile(profile("global"), [
      { op: "remove", section: "preferences", field: "theme" },
      { op: "set", section: "preferences", field: "theme", fieldValue: setField("light") },
    ])).toThrow("Patch contains duplicate field paths");
  });

  it("enforces field, operation, identifier, time, JSON, and size limits", () => {
    const fields = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`field${index}`, setField(index)]));
    expect(() => serializeProfileOkf(profile("global", { preferences: fields }))).toThrow("Profile exceeds 256 fields");
    const operations: ProfilePatchOperation[] = Array.from({ length: 65 }, (_, index) => ({ op: "remove", section: "preferences", field: `field${index}` }));
    expect(() => patchProfile(profile("global"), operations)).toThrow("Patch exceeds 64 operations");
    expect(() => patchProfile(profile("global"), [{ op: "set", section: "unsafe/path", field: "field", fieldValue: setField("x") }]))
      .toThrow("Profile identifiers must be 1-64 safe characters");
    expect(() => serializeProfileOkf(profile("global", { preferences: { invalid: setField("x", {
      provenance: { kind: "user_explicit", recorded_at: "not-time" },
    }) } }))).toThrow("Must be an RFC3339 timestamp");
    expect(() => serializeProfileOkf(profile("global", { preferences: { invalid: setField(undefined as never) } }))).toThrow();
    expect(() => serializeProfileOkf(profile("global", { preferences: { invalid: setField(Number.NaN) } }))).toThrow();
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => serializeProfileOkf(profile("global", { preferences: { invalid: setField(cyclic as never) } }))).toThrow("Field value must be JSON-safe");
    expect(() => serializeProfileOkf(profile("global", {}, { padding: "x".repeat(MAX_PROFILE_BYTES) }))).toThrow(`Profile exceeds ${MAX_PROFILE_BYTES} bytes`);
  });
});
