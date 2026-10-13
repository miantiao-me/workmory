import { z } from "zod";

const segment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export const projectSchema = z.string().min(1).max(128).regex(segment, "project must be a stable identifier");
export const namespaceSchema = z.string().min(1).max(64).regex(segment).default("default");
export const keySchema = z.string().min(1).max(256).regex(keyPattern, "key must contain safe path segments");
export const operationIdSchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const revisionSchema = z.number().int().nonnegative();
const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export const utf8StringSchema = (maxBytes: number, label: string) =>
  z.string().min(1).refine((value) => utf8Bytes(value) <= maxBytes, `${label} must be at most ${maxBytes} UTF-8 bytes`);
export const tagSchema = utf8StringSchema(64, "tag");
export const kindSchema = utf8StringSchema(128, "kind");
export const statusSchema = utf8StringSchema(64, "status");

export const memoryScopeSchema = {
  project: projectSchema,
  namespace: namespaceSchema,
};
