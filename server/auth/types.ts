export interface AccessAuthConfig {
  teamDomain: string;
  audience: string;
}

export interface AccessClaims {
  issuer: string;
  audience: string;
  subject: string;
  type: string;
}

export interface AccessTokenVerifier {
  verify(token: string, config: AccessAuthConfig): Promise<AccessClaims>;
}

export interface AuthEnvironment {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ROOT_API_KEY: string;
}

export class AuthenticationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}
