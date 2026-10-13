import { describe, expect, it } from "vitest";
import { parseEnv } from "../server/env";

describe("runtime environment", () => {
  const rootOnly = {
    EMBEDDING_MODEL: "@cf/qwen/qwen3-embedding-0.6b",
    EMBEDDING_DIMENSIONS: "1024",
    VECTOR_INDEX_VERSION: "v1",
    ROOT_API_KEY: "r".repeat(32),
  };

  it("accepts root-only configuration without Access variables", () => {
    expect(parseEnv(rootOnly)).toMatchObject({ ROOT_API_KEY: "r".repeat(32) });
  });

  it("requires Access variables to be configured as a pair", () => {
    expect(() => parseEnv({ ...rootOnly, ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com" })).toThrow(
      "ACCESS_TEAM_DOMAIN and ACCESS_AUD must be configured together",
    );
    expect(() => parseEnv({ ...rootOnly, ACCESS_AUD: "audience" })).toThrow(
      "ACCESS_TEAM_DOMAIN and ACCESS_AUD must be configured together",
    );
  });

  it("validates required configuration and secret", () => {
    expect(
      parseEnv({
        ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
        ACCESS_AUD: "audience",
        EMBEDDING_MODEL: "@cf/qwen/qwen3-embedding-0.6b",
        EMBEDDING_DIMENSIONS: "1024",
        VECTOR_INDEX_VERSION: "v1",
        ROOT_API_KEY: "r".repeat(32),
      }),
    ).toMatchObject({ ROOT_API_KEY: "r".repeat(32) });
  });

  it("does not require or expose legacy host and origin settings", () => {
    expect(parseEnv(rootOnly)).not.toHaveProperty("PUBLIC_HOST");
    expect(parseEnv({ ...rootOnly, PUBLIC_HOST: "anything", ALLOWED_ORIGINS: "anything" })).not.toMatchObject({
      PUBLIC_HOST: expect.anything(),
      ALLOWED_ORIGINS: expect.anything(),
    });
  });

  it("keeps Access team domains HTTPS-only", () => {
    expect(() => parseEnv({ ...rootOnly, ACCESS_TEAM_DOMAIN: "http://localhost:3000", ACCESS_AUD: "audience" })).toThrow(
      "ACCESS_TEAM_DOMAIN must be a deployed HTTPS origin",
    );
  });

  it("requires the root API key to be supplied as a secret", () => {
    expect(() =>
      parseEnv({
        ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
        ACCESS_AUD: "audience",
        EMBEDDING_MODEL: "@cf/qwen/qwen3-embedding-0.6b",
        EMBEDDING_DIMENSIONS: "1024",
        VECTOR_INDEX_VERSION: "v1",
      }),
    ).toThrow();
  });

  it("keeps rejecting short and placeholder root secrets in root-only mode", () => {
    for (const ROOT_API_KEY of ["short", "replace-with-a-secret-that-is-long-enough"]) {
      expect(() => parseEnv({ ...rootOnly, ROOT_API_KEY })).toThrow();
    }
  });

  it("rejects deployment sentinels and common secret placeholders", () => {
    const valid = {
      ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      ACCESS_AUD: "audience",
      EMBEDDING_MODEL: "@cf/qwen/qwen3-embedding-0.6b",
      EMBEDDING_DIMENSIONS: "1024",
      VECTOR_INDEX_VERSION: "v1",
      ROOT_API_KEY: "r".repeat(32),
    };
    for (const patch of [
      { ACCESS_TEAM_DOMAIN: "https://replace-before-deploy.invalid" },
      { ACCESS_AUD: "replace-before-deploy" },
      { VECTOR_INDEX_VERSION: "change-me" },
      { ROOT_API_KEY: "replace-with-a-secret-that-is-long-enough" },
    ]) {
      expect(() => parseEnv({ ...valid, ...patch })).toThrow();
    }
  });
});
