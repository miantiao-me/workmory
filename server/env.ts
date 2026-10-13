import { z } from "zod";
import { utf8Length } from "./shared/crypto";

const DEPLOY_SENTINEL = "replace-before-deploy";
const PLACEHOLDER_PATTERN = /(?:replace[-_ ]?(?:before[-_ ]?deploy|with)|change[-_ ]?me|your[-_ ]|placeholder|insert[-_ ])/i;

function isDeployedValue(value: string): boolean {
  return !value.toLowerCase().includes(DEPLOY_SENTINEL) && !PLACEHOLDER_PATTERN.test(value);
}

export const envSchema = z.object({
  ACCESS_TEAM_DOMAIN: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && isDeployedValue(value);
  }, "ACCESS_TEAM_DOMAIN must be a deployed HTTPS origin").optional(),
  ACCESS_AUD: z.string().min(1).refine(isDeployedValue, "ACCESS_AUD must not be a placeholder").optional(),
  EMBEDDING_MODEL: z.string().min(1).refine(isDeployedValue),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive(),
  VECTOR_INDEX_VERSION: z.string().min(1).refine(isDeployedValue, "VECTOR_INDEX_VERSION must not be a placeholder"),
  ROOT_API_KEY: z.string().refine(
    (value) => utf8Length(value) >= 32 && isDeployedValue(value),
    "ROOT_API_KEY must be at least 32 bytes and must not be a placeholder",
  ),
}).superRefine((value, context) => {
  if ((value.ACCESS_TEAM_DOMAIN === undefined) !== (value.ACCESS_AUD === undefined)) {
    context.addIssue({
      code: "custom",
      path: value.ACCESS_TEAM_DOMAIN === undefined ? ["ACCESS_TEAM_DOMAIN"] : ["ACCESS_AUD"],
      message: "ACCESS_TEAM_DOMAIN and ACCESS_AUD must be configured together",
    });
  }
});

export type RuntimeEnv = z.infer<typeof envSchema>;
export type RuntimeBindings = Pick<Env, "DB" | "BUCKET" | "VECTORIZE" | "AI"> & Omit<RuntimeEnv, "EMBEDDING_DIMENSIONS"> & {
  EMBEDDING_DIMENSIONS: string | number;
};

export function parseEnv(env: unknown): RuntimeEnv {
  return envSchema.parse(env);
}
