import { OKF_VERSION } from "../../server/domain/okf";
import { PROFILE_BODY, PROFILE_OKF_TYPE, PROFILE_VERSION } from "../../server/domain/profile";
import type { ProfileDocument, ProfileFrontmatter, SetProfileField, SuppressedProfileField } from "../../server/profile/types";

export const RECORDED_AT = "2026-08-19T10:00:00Z";

export function setField(value: SetProfileField["value"], overrides: Partial<SetProfileField> = {}): SetProfileField {
  return {
    state: "set",
    value,
    provenance: { kind: "user_explicit", recorded_at: RECORDED_AT },
    sensitivity: "normal",
    ...overrides,
  };
}

export function suppressedField(overrides: Partial<SuppressedProfileField> = {}): SuppressedProfileField {
  return {
    state: "suppressed",
    provenance: { kind: "user_explicit", recorded_at: RECORDED_AT },
    sensitivity: "normal",
    ...overrides,
  };
}

export function profile(
  scope: "global" | "project",
  sections: ProfileFrontmatter["sections"] = {},
  extras: Record<string, unknown> = {},
): ProfileDocument {
  return {
    frontmatter: {
      okf_version: OKF_VERSION,
      type: PROFILE_OKF_TYPE,
      profile_version: PROFILE_VERSION,
      scope,
      ...(scope === "project" ? { project: "workmory" } : {}),
      sections,
      ...extras,
    },
    body: PROFILE_BODY,
  };
}
