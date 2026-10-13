import { describe, expect, it } from "vitest";
import { memoryRequestFingerprint } from "../server/application/memory-preparation";
import type { StoreMemoryRequest } from "../server/application/memory-service";

describe("memory preparation contracts", () => {
  it("preserves the canonical request fingerprint", async () => {
    const request: StoreMemoryRequest = {
      project: "workmory",
      namespace: "default",
      key: "golden/memory",
      source: { content: "Canonical body" },
      frontmatter: { title: "Golden" },
      kind: "Decision",
      tags: ["golden", "contract"],
      operationId: "golden-operation-001",
    };
    const expected = "9974a0eefdcf23a09b1b3479b5be4fc0c93a905e3e754b55018b8f16b937f31f";
    await expect(memoryRequestFingerprint(request)).resolves.toBe(expected);
    await expect(memoryRequestFingerprint({ ...request, indexable: true })).resolves.toBe(expected);
    await expect(memoryRequestFingerprint({ ...request, indexable: false })).resolves.not.toBe(expected);
  });
});
