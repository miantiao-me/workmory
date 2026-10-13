import { z } from "zod";
import { OKF_VERSION } from "../domain/okf";
import { PROFILE_OKF_TYPE, PROFILE_VERSION } from "../domain/profile";
import type { JsonValue, ProfileSections } from "./types";

export const MAX_PROFILE_BYTES = 256 * 1024;
export const MAX_PROFILE_FIELDS = 256;
export const MAX_PROFILE_PATCH_OPERATIONS = 64;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HIGH_RISK_SECTIONS = new Set([
  "authentication",
  "secrets",
  "health",
  "politics",
  "religion",
  "finance",
  "biometric",
]);

export const profileIdentifierSchema = z.string()
  .regex(IDENTIFIER_PATTERN, "Profile identifiers must be 1-64 safe characters");

const sourceIdSchema = z.string().min(1, "source_ids entries must not be empty").max(256);
export const profileTimestampSchema = z.iso.datetime({ offset: true, message: "Must be an RFC3339 timestamp" });
export const profileDateSchema = z.iso.date({ message: "Must use YYYY-MM-DD" });

function isJsonSafe(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonSafe(item, ancestors))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
      Object.values(value as Record<string, unknown>).every((item) => isJsonSafe(item, ancestors));
  ancestors.delete(value);
  return valid;
}

export const profileJsonValueSchema = z.custom<JsonValue>(isJsonSafe, "Field value must be JSON-safe");

export const profileProvenanceSchema = z.object({
  kind: z.enum(["user_explicit", "user_imported", "agent_inferred"]),
  source_ids: z.array(sourceIdSchema).optional(),
  recorded_at: profileTimestampSchema,
}).passthrough();

const fieldMetadataShape = {
  provenance: profileProvenanceSchema,
  confidence: z.number().min(0).max(1).optional(),
  sensitivity: z.enum(["normal", "personal", "sensitive"]).default("normal"),
  stale_after: profileDateSchema.optional(),
  expires_at: profileTimestampSchema.optional(),
};

export const setProfileFieldSchema = z.object({
  state: z.literal("set"),
  value: profileJsonValueSchema,
  ...fieldMetadataShape,
}).passthrough();

export const suppressedProfileFieldSchema = z.object({
  state: z.literal("suppressed"),
  ...fieldMetadataShape,
}).passthrough().superRefine((field, context) => {
  if ("value" in field) context.addIssue({ code: "custom", message: "Suppressed fields must not contain value" });
});

export const profileWireSetFieldSchema = z.object({
  state: z.literal("set"),
  value: z.json(),
  ...fieldMetadataShape,
}).passthrough();

export const profileWireSuppressedFieldSchema = suppressedProfileFieldSchema;

const profileFieldSchema = z.discriminatedUnion("state", [setProfileFieldSchema, suppressedProfileFieldSchema]);

function normalizedSection(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function profileFieldPolicyIssue(section: string, field: z.infer<typeof profileFieldSchema>): string | undefined {
  if (field.provenance.kind !== "agent_inferred") return undefined;
  if (field.confidence === undefined) return "Agent-inferred fields require confidence";
  if (!field.provenance.source_ids?.length) return "Agent-inferred fields require source_ids";
  if (!field.stale_after) return "Agent-inferred fields require stale_after";
  if (field.sensitivity === "sensitive") return "Agent-inferred fields cannot be sensitive";
  if (HIGH_RISK_SECTIONS.has(normalizedSection(section))) {
    return "Agent inference is not allowed for this section";
  }
  return undefined;
}

const sectionsSchema = z.record(
  profileIdentifierSchema,
  z.record(profileIdentifierSchema, profileFieldSchema),
);

export const profileFrontmatterSchema = z.object({
  okf_version: z.literal(OKF_VERSION),
  type: z.literal(PROFILE_OKF_TYPE),
  profile_version: z.literal(PROFILE_VERSION),
  scope: z.enum(["global", "project"]),
  project: z.string().min(1).max(128).optional(),
  sections: sectionsSchema,
}).passthrough().superRefine((frontmatter, context) => {
  let fields = 0;
  for (const [section, values] of Object.entries(frontmatter.sections)) {
    fields += Object.keys(values).length;
    for (const field of Object.values(values)) {
      const issue = profileFieldPolicyIssue(section, field);
      if (issue !== undefined) {
        context.addIssue({ code: "custom", path: ["sections", section], message: issue });
      }
    }
  }
  if (fields > MAX_PROFILE_FIELDS) {
    context.addIssue({ code: "custom", path: ["sections"], message: `Profile exceeds ${MAX_PROFILE_FIELDS} fields` });
  }
});

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileValidationError";
  }
}

export function profileErrorMessage(error: unknown): string {
  if (error instanceof ProfileValidationError) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Invalid profile";
  return error instanceof Error ? error.message : "Invalid profile";
}

export function parseProfileFrontmatter(value: unknown) {
  const result = profileFrontmatterSchema.safeParse(value);
  if (!result.success) throw new ProfileValidationError(profileErrorMessage(result.error));
  return { ...result.data, sections: cloneProfileSections(result.data.sections) };
}

export function cloneProfileSections(sections: ProfileSections): ProfileSections {
  const copy: ProfileSections = Object.create(null);
  for (const [section, fields] of Object.entries(sections)) {
    const fieldCopy: ProfileSections[string] = Object.create(null);
    for (const [field, profileField] of Object.entries(fields)) fieldCopy[field] = profileField;
    copy[section] = fieldCopy;
  }
  return copy;
}

const patchBase = { section: profileIdentifierSchema, field: profileIdentifierSchema };
export const profileOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), ...patchBase, fieldValue: setProfileFieldSchema }),
  z.object({ op: z.literal("remove"), ...patchBase }),
  z.object({ op: z.literal("suppress"), ...patchBase, fieldValue: suppressedProfileFieldSchema }),
]).superRefine((operation, context) => {
  if (operation.op === "remove") return;
  const issue = profileFieldPolicyIssue(operation.section, operation.fieldValue);
  if (issue !== undefined) context.addIssue({ code: "custom", message: issue });
});

export type ValidatedProfileOperation = z.output<typeof profileOperationSchema>;

const profilePatchSchema = z.array(profileOperationSchema)
  .max(MAX_PROFILE_PATCH_OPERATIONS, `Patch exceeds ${MAX_PROFILE_PATCH_OPERATIONS} operations`)
  .superRefine((operations, context) => {
    const paths = new Set<string>();
    for (const operation of operations) {
      const path = `${operation.section}\0${operation.field}`;
      if (paths.has(path)) context.addIssue({ code: "custom", message: "Patch contains duplicate field paths" });
      paths.add(path);
    }
  });

export function parseProfileOperations(value: unknown, scope: "global" | "project") {
  const result = profilePatchSchema.safeParse(value);
  if (!result.success) throw new ProfileValidationError(profileErrorMessage(result.error));
  if (scope === "global" && result.data.some((operation) => operation.op === "suppress")) {
    throw new ProfileValidationError("Suppress is only allowed in project scope");
  }
  return result.data;
}
