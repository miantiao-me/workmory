import { describe, expect, it } from "vitest";
import { profileUpdateFingerprint } from "../server/profile/fingerprint";

describe("profile operation fingerprints", () => {
  it("preserves the canonical profile update fingerprint", async () => {
    await expect(profileUpdateFingerprint({
      scope: "global",
      expectedRevision: 0,
      operations: [{
        op: "set",
        section: "preferences",
        field: "theme",
        fieldValue: {
          state: "set",
          value: "dark",
          provenance: { kind: "user_explicit", recorded_at: "2026-08-19T10:00:00Z" },
          sensitivity: "normal",
        },
      }],
    })).resolves.toBe("7e4e0144fe70d37c67da3635d1720323575fe9c6d7c6eb51d1168883c58f5447");
  });
});
