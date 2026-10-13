import { tagSchema } from "./contracts";

export class MemoryTagValidationError extends Error {}

export function normalizeMemoryTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 32) throw new MemoryTagValidationError("tags must contain at most 32 entries");
  return [...new Set(value.filter((tag): tag is string => tagSchema.safeParse(tag).success))];
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
