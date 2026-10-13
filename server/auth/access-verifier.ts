import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import type { AccessAuthConfig, AccessClaims, AccessTokenVerifier } from "./types";

export interface JoseAccessTokenVerifierOptions {
  fetch?: typeof fetch;
  keyResolver?: JWTVerifyGetKey;
}

export class JoseAccessTokenVerifier implements AccessTokenVerifier {
  private readonly resolvers = new Map<string, JWTVerifyGetKey>();

  constructor(private readonly options: JoseAccessTokenVerifierOptions = {}) {}

  private resolver(config: AccessAuthConfig): JWTVerifyGetKey {
    if (this.options.keyResolver) return this.options.keyResolver;
    const existing = this.resolvers.get(config.teamDomain);
    if (existing) return existing;
    const resolver = createRemoteJWKSet(new URL(`${config.teamDomain}/cdn-cgi/access/certs`), {
      ...(this.options.fetch ? { [customFetch]: this.options.fetch } : {}),
    });
    this.resolvers.set(config.teamDomain, resolver);
    return resolver;
  }

  async verify(token: string, config: AccessAuthConfig): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.resolver(config), {
      algorithms: ["RS256"],
      issuer: config.teamDomain,
      audience: config.audience,
      requiredClaims: ["exp"],
    });
    if (payload.type !== "app" || typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new Error("invalid access claims");
    }
    return {
      issuer: config.teamDomain,
      audience: config.audience,
      subject: payload.sub,
      type: payload.type,
    };
  }
}
