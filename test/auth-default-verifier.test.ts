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
    const extras: Record<string, string>[] = [
      {},
      { Authorization: "Bearer token" },
      { "Cf-Access-Jwt-Assertion": "token" },
      { Cookie: "CF_Authorization=token" },
      { "Cf-Access-Client-Id": "id" },
      { "Cf-Access-Client-Secret": "secret" },
      { Authorization: "", "Cf-Access-Jwt-Assertion": "", Cookie: "", "Cf-Access-Client-Id": "", "Cf-Access-Client-Secret": "" },
    ];
    for (const extra of extras) {
      for (const pathKey of [undefined, "wrong-path"]) {
        await authenticateRequest(request({ ...extra, "X-API-Key": rootKey }), rootOnlyEnv, undefined, pathKey);
        for (const key of ["", "wrong"]) {
          await expect(authenticateRequest(request({ ...extra, "X-API-Key": key }), accessEnv, undefined, pathKey))
            .rejects.toMatchObject({ code: "AUTH_INVALID" });
        }
      }
    }
    await expect(
      authenticateRequest(request({ Authorization: "Bearer token" }), rootOnlyEnv),
    ).rejects.toMatchObject({ code: "AUTH_CONFIG_INVALID" });
    expect(verifierMocks.construct).not.toHaveBeenCalled();
    expect(verifierMocks.verify).not.toHaveBeenCalled();

    const first = await authenticateRequest(request({ Authorization: "Bearer first" }), accessEnv);
    const second = await authenticateRequest(request({ "Cf-Access-Jwt-Assertion": "second" }), accessEnv);

    expect(first).toEqual(second);
    expect(verifierMocks.construct).toHaveBeenCalledTimes(1);
    expect(verifierMocks.verify).toHaveBeenCalledTimes(2);
  });
});
