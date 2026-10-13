import { sha256Hex } from "../shared/crypto";
import { stableJson } from "../shared/stable-json";
import type { ProfilePatchOperation, ProfileScope } from "./types";

function normalizeProfileOperationsForFingerprint(
  operations: readonly ProfilePatchOperation[],
): ProfilePatchOperation[] {
  return operations.map((operation) => {
    if (operation.op === "remove") return { op: "remove", section: operation.section, field: operation.field };
    return {
      op: operation.op,
      section: operation.section,
      field: operation.field,
      fieldValue: { ...operation.fieldValue, sensitivity: operation.fieldValue.sensitivity ?? "normal" },
    } as ProfilePatchOperation;
  });
}

export function profileUpdateFingerprint(input: {
  scope: ProfileScope;
  project?: string;
  expectedRevision?: number;
  operations: readonly ProfilePatchOperation[];
}): Promise<string> {
  return sha256Hex(stableJson({
    action: "profile_update",
    scope: input.scope,
    project: input.project ?? null,
    expectedRevision: input.expectedRevision ?? null,
    operations: normalizeProfileOperationsForFingerprint(input.operations).sort((left, right) =>
      left.section.localeCompare(right.section) || left.field.localeCompare(right.field)),
  }));
}

export function profileDeleteFingerprint(input: {
  scope: ProfileScope;
  project?: string;
  expectedRevision?: number;
}): Promise<string> {
  return sha256Hex(stableJson({
    action: "profile_delete",
    scope: input.scope,
    project: input.project ?? null,
    expectedRevision: input.expectedRevision ?? null,
  }));
}
