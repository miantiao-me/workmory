import { describe, expect, it } from "vitest";
import { projectSchema } from "../server/domain/contracts";
import { PROFILE_GLOBAL_KEY, PROFILE_NAMESPACE, PROFILE_PROJECT } from "../server/domain/profile";
import { storeInputSchema } from "../server/mcp/memory-contracts";

describe("internal profile memory contracts", () => {
  it("keeps the profile scope internal and outside public project validation", () => {
    expect({ PROFILE_PROJECT, PROFILE_NAMESPACE, PROFILE_GLOBAL_KEY }).toEqual({
      PROFILE_PROJECT: "__workmory_profile__",
      PROFILE_NAMESPACE: "profile",
      PROFILE_GLOBAL_KEY: "global",
    });
    expect(projectSchema.safeParse(PROFILE_PROJECT).success).toBe(false);
  });

  it("does not accept indexable through the public MCP store contract", () => {
    expect(storeInputSchema.safeParse({
      project: "workmory",
      namespace: "default",
      key: "public/memory",
      content: "body",
      indexable: false,
    }).success).toBe(false);
  });
});
