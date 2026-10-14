import type { ActorContext } from "../domain/identity";
import { constantTimeDigestEqual, sha256Hex, utf8Length } from "../shared/crypto";
import { JoseAccessTokenVerifier } from "./access-verifier";
import { AuthenticationError, type AccessTokenVerifier, type AuthEnvironment } from "./types";

let defaultAccessTokenVerifier: AccessTokenVerifier | undefined;

function getDefaultAccessTokenVerifier(): AccessTokenVerifier {
  return defaultAccessTokenVerifier ??= new JoseAccessTokenVerifier();
}

export async function authenticateRequest(
  request: Request,
  env: AuthEnvironment,
  verifier?: AccessTokenVerifier,
  pathApiKey?: string,
): Promise<ActorContext> {
  if (request.headers.has("cf-access-client-id") || request.headers.has("cf-access-client-secret") || request.headers.has("cookie")) {
    throw new AuthenticationError(400, "AUTH_UNSUPPORTED", "Unsupported authentication credential");
  }
  const headerKey = request.headers.get("x-api-key");
  const authorization = request.headers.get("authorization");
  const assertion = request.headers.get("cf-access-jwt-assertion");
  const present = [pathApiKey, headerKey, authorization, assertion].filter((value) => value !== null && value !== undefined).length;
  if (present > 1) throw new AuthenticationError(400, "AUTH_AMBIGUOUS", "Multiple authentication credentials were provided");
  if (present === 0) throw new AuthenticationError(401, "AUTH_REQUIRED", "Authentication is required");

  const rootKey = pathApiKey ?? headerKey;
  if (rootKey !== null) {
    if (utf8Length(env.ROOT_API_KEY) < 32) throw new AuthenticationError(503, "AUTH_CONFIG_INVALID", "Authentication is unavailable");
    if (!(await constantTimeDigestEqual(rootKey, env.ROOT_API_KEY))) throw new AuthenticationError(401, "AUTH_INVALID", "Authentication failed");
    const fingerprint = (await sha256Hex(env.ROOT_API_KEY)).slice(0, 16);
    return { ownerId: "root", actorId: `root:${fingerprint}`, authKind: "root" };
  }

  const token = assertion ?? (/^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1] || undefined);
  if (!token) throw new AuthenticationError(401, "AUTH_INVALID", "Authentication failed");
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    throw new AuthenticationError(503, "AUTH_CONFIG_INVALID", "Access authentication is not configured");
  }
  try {
    const claims = await (verifier ?? getDefaultAccessTokenVerifier()).verify(token, {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      audience: env.ACCESS_AUD,
    });
    const stable = await sha256Hex(`${claims.issuer}\u0000${claims.audience}\u0000${claims.subject}`);
    return { ownerId: `access_${stable.slice(0, 32)}`, actorId: `access:${stable}`, authKind: "access" };
  } catch {
    throw new AuthenticationError(401, "AUTH_INVALID", "Authentication failed");
  }
}
