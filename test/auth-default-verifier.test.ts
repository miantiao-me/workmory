import { describe, expect, it, vi } from "vitest";

const verifierMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  verify: vi.fn(async () => ({
    issuer: "https://team.cloudflareaccess.com",
    audience: "access-audience",
    subject: "stable-subject",
    type: "app" as const,
  })),
}));

vi.mock("../server/auth/access-verifier", () => ({
  JoseAccessTokenVerifier: class {
    constructor() {
      verifierMocks.construct();
    }

    verify = verifierMocks.verify;
  },
}));

import { authenticateRequest } from "../server/auth/authenticate";

const rootKey = "root-secret-value-that-is-at-least-32-bytes";
const rootOnlyEnv = { ROOT_API_KEY: rootKey };
const accessEnv = {
  ...rootOnlyEnv,
  ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
  ACCESS_AUD: "access-audience",
};

function request(headers: HeadersInit): Request {
  return new Request("https://api.example.com/mcp", { method: "POST", headers });
}

describe("default Access verifier lifecycle", () => {
  it("constructs lazily for configured Access and reuses it across requests", async () => {
    await authenticateRequest(request({ "X-API-Key": rootKey }), rootOnlyEnv);
    await expect(
      authenticateRequest(request({ Authorization: "Bearer token" }), rootOnlyEnv),
    ).rejects.toMatchObject({ code: "AUTH_CONFIG_INVALID" });
    expect(verifierMocks.construct).not.toHaveBeenCalled();

    const first = await authenticateRequest(request({ Authorization: "Bearer first" }), accessEnv);
    const second = await authenticateRequest(request({ "Cf-Access-Jwt-Assertion": "second" }), accessEnv);

    expect(first).toEqual(second);
    expect(verifierMocks.construct).toHaveBeenCalledTimes(1);
    expect(verifierMocks.verify).toHaveBeenCalledTimes(2);
  });
});
