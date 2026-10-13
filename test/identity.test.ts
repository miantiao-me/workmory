import { describe, expect, it } from "vitest";
import {
  memoryOpaqueId,
  projectOpaqueId,
  vectorScopeId,
} from "../server/domain/identity";

describe("stable identity outputs", () => {
  it("preserves project, memory, and Vectorize namespace identifiers", async () => {
    const projectId = await projectOpaqueId("subject-a", "workmory");
    expect(projectId).toBe("prj_961fdb7e5543c6fb88da2858601083c5");

    const memoryId = await memoryOpaqueId(projectId, "default", "architecture/runtime");
    expect(memoryId).toBe("mem_fc229ab8992675738ced14d2480a03e3");
    await expect(vectorScopeId("subject-a", "workmory", "default", "test-v1"))
      .resolves.toBe("scope_fac3eb4ec36b7e5cea8f2739da051183bfca9163");
  });
});
