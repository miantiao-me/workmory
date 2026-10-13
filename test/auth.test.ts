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

  it("fails closed for Access credentials when Access is not configured", async () => {
    const unusedVerifier: AccessTokenVerifier = { verify: vi.fn(async () => { throw new Error("must not run"); }) };
    const credentials: HeadersInit[] = [
      { Authorization: "Bearer token" },
      { "Cf-Access-Jwt-Assertion": "token" },
    ];
    for (const headers of credentials) {
      await expect(authenticateRequest(request(headers), rootOnlyEnv, unusedVerifier)).rejects.toMatchObject({
        code: "AUTH_CONFIG_INVALID",
        status: 503,
      });
    }
    expect(unusedVerifier.verify).not.toHaveBeenCalled();
  });

  it("rejects ambiguity, missing credentials, unsupported credentials, and never falls back", async () => {
    await expect(
      authenticateRequest(request({ Authorization: "Bearer invalid", "X-API-Key": rootKey }), env, verifier),
    ).rejects.toMatchObject({ code: "AUTH_AMBIGUOUS", status: 400 });
    await expect(authenticateRequest(request({}), env, verifier)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(authenticateRequest(request({ Cookie: "CF_Authorization=x" }), env, verifier)).rejects.toMatchObject({ code: "AUTH_UNSUPPORTED" });
    await expect(authenticateRequest(request({ "CF-Access-Client-Id": "id" }), env, verifier)).rejects.toMatchObject({ code: "AUTH_UNSUPPORTED" });
    await expect(
      authenticateRequest(request({ Authorization: "Basic value", "X-API-Key": "wrong" }), env, verifier),
    ).rejects.toMatchObject({ code: "AUTH_AMBIGUOUS" });
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
