import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { JoseAccessTokenVerifier } from "../server/auth/access-verifier";
import { authenticateRequest } from "../server/auth/authenticate";
import type { AccessTokenVerifier } from "../server/auth/types";

const issuer = "https://team.cloudflareaccess.com";
const audience = "access-audience";
const rootKey = "root-secret-value-that-is-at-least-32-bytes";
const env = { ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: audience, ROOT_API_KEY: rootKey };
const rootOnlyEnv = { ROOT_API_KEY: rootKey };
let privateKey: CryptoKey;
let wrongPrivateKey: CryptoKey;
let verifier: JoseAccessTokenVerifier;

beforeAll(async () => {
  const rs256 = await generateKeyPair("RS256", { extractable: true });
  const rs384 = await generateKeyPair("RS384", { extractable: true });
  privateKey = rs256.privateKey;
  wrongPrivateKey = rs384.privateKey;
  const validJwk = await exportJWK(rs256.publicKey);
  const wrongJwk = await exportJWK(rs384.publicKey);
  validJwk.kid = "valid";
  wrongJwk.kid = "wrong";
  verifier = new JoseAccessTokenVerifier({ keyResolver: createLocalJWKSet({ keys: [validJwk, wrongJwk] }) });
});

async function token(
  overrides: Record<string, unknown> = {},
  options: { alg?: "RS256" | "RS384"; key?: CryptoKey; kid?: string; now?: number } = {},
): Promise<string> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  return new SignJWT({ type: "app", ...overrides })
    .setProtectedHeader({ alg: options.alg ?? "RS256", kid: options.kid ?? "valid" })
    .setIssuer((overrides.iss as string) ?? issuer)
    .setAudience((overrides.aud as string) ?? audience)
    .setSubject((overrides.sub as string) ?? "stable-subject")
    .setIssuedAt(now)
    .setExpirationTime((overrides.exp as number) ?? now + 300)
    .setNotBefore((overrides.nbf as number) ?? now - 1)
    .sign(options.key ?? privateKey);
}

async function tokenWithoutExp(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "valid" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("stable-subject")
    .setIssuedAt(now)
    .setNotBefore(now - 1)
    .sign(privateKey);
}

function request(headers: HeadersInit): Request {
  return new Request("https://api.example.com/mcp", { method: "POST", headers });
}

describe("request authentication", () => {
  it("verifies RS256 Access application claims", async () => {
    const actor = await authenticateRequest(request({ Authorization: `Bearer ${await token()}` }), env, verifier);
    expect(actor).toMatchObject({ authKind: "access" });
    expect(actor.ownerId).toMatch(/^access_/);
  });

  it("rejects wrong audience, issuer, algorithm, time, type, and subject", async () => {
    const now = Math.floor(Date.now() / 1000);
    const invalid = [
      await token({ aud: "wrong" }, { now }),
      await token({ iss: "https://other.cloudflareaccess.com" }, { now }),
      await token({}, { alg: "RS384", key: wrongPrivateKey, kid: "wrong", now }),
      await token({ exp: now - 1 }, { now }),
      await token({ nbf: now + 300 }, { now }),
      await token({ type: "user" }, { now }),
      await token({ sub: "" }, { now }),
    ];
    for (const jwt of invalid) {
      await expect(authenticateRequest(request({ "Cf-Access-Jwt-Assertion": jwt }), env, verifier)).rejects.toMatchObject({
        code: "AUTH_INVALID",
        status: 401,
      });
    }
    // A token without exp must never be accepted: credentials must be time-bounded.
    await expect(
      authenticateRequest(request({ "Cf-Access-Jwt-Assertion": await tokenWithoutExp() }), env, verifier),
    ).rejects.toMatchObject({ code: "AUTH_INVALID", status: 401 });
  });

  it("supports root with a stable fingerprint without exposing the secret", async () => {
    const unusedVerifier: AccessTokenVerifier = { verify: vi.fn(async () => { throw new Error("must not run"); }) };
    const actor = await authenticateRequest(request({ "X-API-Key": rootKey }), rootOnlyEnv, unusedVerifier);
    expect(actor).toMatchObject({ ownerId: "root", authKind: "root" });
    expect(actor.actorId).toMatch(/^root:[a-f0-9]{16}$/);
    expect(unusedVerifier.verify).not.toHaveBeenCalled();
    await expect(authenticateRequest(request({ "X-API-Key": "wrong" }), rootOnlyEnv, unusedVerifier)).rejects.not.toThrow(rootKey);
  });

  it("authenticates path keys as the same root actor without using Access", async () => {
    const unusedVerifier: AccessTokenVerifier = { verify: vi.fn(async () => { throw new Error("must not run"); }) };
    const actor = await authenticateRequest(request({}), rootOnlyEnv, unusedVerifier, rootKey);
    expect(actor).toEqual(await authenticateRequest(request({ "X-API-Key": rootKey }), rootOnlyEnv, unusedVerifier));
    for (const key of ["wrong", ""]) {
      await expect(authenticateRequest(request({}), rootOnlyEnv, unusedVerifier, key)).rejects.toMatchObject({ status: 401, code: "AUTH_INVALID" });
    }
    await expect(authenticateRequest(request({}), { ROOT_API_KEY: "short" }, unusedVerifier, "short"))
      .rejects.toMatchObject({ status: 503, code: "AUTH_CONFIG_INVALID" });
    expect(unusedVerifier.verify).not.toHaveBeenCalled();
  });

  it("prioritizes a present header key over every other source without using Access", async () => {
    const unusedVerifier: AccessTokenVerifier = { verify: vi.fn(async () => { throw new Error("must not run"); }) };
    const jwt = await token();
    const sources: Record<string, string>[] = [
      { Authorization: `Bearer ${jwt}` },
      { "Cf-Access-Jwt-Assertion": jwt },
      { Cookie: "CF_Authorization=ignored; analytics=value" },
      { "Cf-Access-Client-Id": "id" },
      { "Cf-Access-Client-Secret": "secret" },
    ];
    const expected = await authenticateRequest(request({ "X-API-Key": rootKey }), env, unusedVerifier);
    for (const extra of [{}, ...sources, Object.assign({}, ...sources)]) {
      for (const pathKey of [undefined, rootKey, "wrong", ""]) {
        expect(await authenticateRequest(request({ ...extra, "X-API-Key": rootKey }), env, unusedVerifier, pathKey)).toEqual(expected);
        for (const key of ["wrong", ""]) {
          await expect(authenticateRequest(request({ ...extra, "X-API-Key": key }), env, unusedVerifier, pathKey))
            .rejects.toMatchObject({ status: 401, code: "AUTH_INVALID" });
        }
      }
    }
    expect(unusedVerifier.verify).not.toHaveBeenCalled();
  });

  it("keeps source conflicts and service tokens rejected when there is no header key", async () => {
    for (const name of ["Authorization", "Cf-Access-Jwt-Assertion"]) {
      for (const value of ["token", ""]) {
        await expect(authenticateRequest(request({ [name]: value, Cookie: "analytics=value" }), env, verifier, rootKey))
          .rejects.toMatchObject({ status: 400, code: "AUTH_AMBIGUOUS" });
      }
    }
    await expect(authenticateRequest(request({ Authorization: "", "Cf-Access-Jwt-Assertion": "" }), env, verifier))
      .rejects.toMatchObject({ status: 400, code: "AUTH_AMBIGUOUS" });
    for (const name of ["Cf-Access-Client-Id", "Cf-Access-Client-Secret"]) {
      for (const pathKey of [undefined, rootKey]) {
        await expect(authenticateRequest(request({ [name]: "" }), env, verifier, pathKey))
          .rejects.toMatchObject({ status: 400, code: "AUTH_UNSUPPORTED" });
      }
    }
  });

  it("treats cookies as accompanying data and never authenticates their contents", async () => {
    const jwt = await token();
    const expected = await authenticateRequest(request({ Authorization: `Bearer ${jwt}` }), env, verifier);
    for (const cookie of ["analytics=value", `CF_Authorization=${jwt}`, ""]) {
      for (const headers of [{ Authorization: `Bearer ${jwt}` }, { "Cf-Access-Jwt-Assertion": jwt }] as Record<string, string>[]) {
        expect(await authenticateRequest(request({ ...headers, Cookie: cookie }), env, verifier)).toEqual(expected);
      }
      expect(await authenticateRequest(request({ Cookie: cookie }), env, verifier, rootKey))
        .toEqual(await authenticateRequest(request({ "X-API-Key": rootKey }), env, verifier));
      await expect(authenticateRequest(request({ Cookie: cookie }), env, verifier))
        .rejects.toMatchObject({ status: 400, code: "AUTH_UNSUPPORTED" });
      for (const headers of [{ Authorization: "Bearer invalid" }, { Authorization: "" }, { "Cf-Access-Jwt-Assertion": "invalid" }, { "Cf-Access-Jwt-Assertion": "" }] as Record<string, string>[]) {
        await expect(authenticateRequest(request({ ...headers, Cookie: cookie }), env, verifier))
          .rejects.toMatchObject({ status: 401, code: "AUTH_INVALID" });
      }
    }
  });

  it("fails closed for Access credentials when Access is absent or partially configured", async () => {
    const unusedVerifier: AccessTokenVerifier = { verify: vi.fn(async () => { throw new Error("must not run"); }) };
    for (const config of [rootOnlyEnv, { ...rootOnlyEnv, ACCESS_TEAM_DOMAIN: issuer }, { ...rootOnlyEnv, ACCESS_AUD: audience }]) {
      for (const headers of [{ Authorization: "Bearer token" }, { "Cf-Access-Jwt-Assertion": "token" }] as Record<string, string>[]) {
        for (const extra of [{}, { Cookie: "CF_Authorization=token" }] as Record<string, string>[]) {
          await expect(authenticateRequest(request({ ...headers, ...extra }), config, unusedVerifier))
            .rejects.toMatchObject({ code: "AUTH_CONFIG_INVALID", status: 503 });
        }
      }
    }
    expect(unusedVerifier.verify).not.toHaveBeenCalled();
  });

  it("rejects missing credentials and malformed authorization", async () => {
    await expect(authenticateRequest(request({}), env, verifier)).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    await expect(authenticateRequest(request({ Authorization: "Basic value" }), env, verifier))
      .rejects.toMatchObject({ code: "AUTH_INVALID", status: 401 });
  });

  it("derives stable and isolated owners from issuer, audience, and subject", async () => {
    const claims = (subject: string): AccessTokenVerifier => ({
      verify: async () => ({ issuer, audience, subject, type: "app" }),
    });
    const one = await authenticateRequest(request({ Authorization: "Bearer token" }), env, claims("one"));
    const repeat = await authenticateRequest(request({ Authorization: "Bearer token" }), env, claims("one"));
    const two = await authenticateRequest(request({ Authorization: "Bearer token" }), env, claims("two"));
    expect(one).toEqual(repeat);
    expect(one.ownerId).not.toBe(two.ownerId);
    expect(one.ownerId).not.toBe("root");
  });
});
