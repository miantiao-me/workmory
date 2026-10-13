import { z } from "zod";
import { operationIdSchema, projectSchema, revisionSchema } from "../domain/contracts";
import {
  MAX_PROFILE_PATCH_OPERATIONS,
  parseProfileOperations,
  profileErrorMessage,
  profileIdentifierSchema,
  profileWireSetFieldSchema,
  profileWireSuppressedFieldSchema,
} from "../profile/schema";
import type { ProfilePatchOperation } from "../profile/types";

export const profileGetInputSchema = z.object({
  project: projectSchema.optional().describe("Stable project identifier; omit for the global profile."),
  include_sensitive: z.boolean().default(false)
    .describe("Include fields marked sensitive; otherwise they are masked."),
  include_raw: z.boolean().default(false)
    .describe("Include canonical raw profile documents; requires include_sensitive=true."),
}).strict().superRefine((value, context) => {
  if (value.include_raw && !value.include_sensitive) {
    context.addIssue({ code: "custom", message: "include_raw requires include_sensitive" });
  }
});

const profilePatchBase = { section: profileIdentifierSchema, field: profileIdentifierSchema };
const profileWireOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set"),
    ...profilePatchBase,
    field_value: profileWireSetFieldSchema
      .describe("Field value with provenance, sensitivity, and freshness metadata."),
  }).strict(),
  z.object({ op: z.literal("remove"), ...profilePatchBase }).strict(),
  z.object({ op: z.literal("suppress"), ...profilePatchBase, field_value: profileWireSuppressedFieldSchema }).strict()
    .describe("Hide an inherited global field in a project profile; valid only when project is set."),
]);

export function profileOperationsFromWire(operations: readonly z.infer<typeof profileWireOperationSchema>[]): ProfilePatchOperation[] {
  return operations.map((operation): ProfilePatchOperation => {
    if (operation.op === "remove") return operation;
    if (operation.op === "set") {
      return { op: "set", section: operation.section, field: operation.field, fieldValue: operation.field_value };
    }
    return { op: "suppress", section: operation.section, field: operation.field, fieldValue: operation.field_value };
  });
}

export const profileUpdateInputSchema = z.object({
  project: projectSchema.optional().describe("Stable project identifier; omit to update the global profile."),
  operations: z.array(profileWireOperationSchema).min(1).max(MAX_PROFILE_PATCH_OPERATIONS)
    .describe("Ordered profile patch operations."),
  expected_revision: revisionSchema.optional()
    .describe("Require the target profile revision to match before updating."),
  operation_id: operationIdSchema.optional()
    .describe("Idempotency key for safe retries; reuse only with the identical mutation."),
}).strict().superRefine((value, context) => {
  try {
    parseProfileOperations(profileOperationsFromWire(value.operations), value.project === undefined ? "global" : "project");
  } catch (error) {
    context.addIssue({ code: "custom", path: ["operations"], message: profileErrorMessage(error) });
  }
});

export const profileDeleteInputSchema = z.object({
  project: projectSchema.optional().describe("Stable project identifier; omit to delete the global profile."),
  expected_revision: revisionSchema.optional()
    .describe("Require the target profile revision to match before logically deleting."),
  operation_id: operationIdSchema.optional()
    .describe("Idempotency key for safe retries; reuse only with the identical mutation."),
}).strict();

export type ProfileGetInput = z.infer<typeof profileGetInputSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateInputSchema>;
export type ProfileDeleteInput = z.infer<typeof profileDeleteInputSchema>;
