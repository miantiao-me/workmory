import type { McpServer } from "@modelcontextprotocol/server";
import type { ProfileService } from "../profile/profile-service";
import {
  profileDeleteInputSchema,
  profileGetInputSchema,
  profileOperationsFromWire,
  profileUpdateInputSchema,
  type ProfileDeleteInput,
  type ProfileGetInput,
  type ProfileUpdateInput,
} from "./profile-contracts";
import { TOOL_DESCRIPTIONS } from "./guidance";
import { toolResult } from "./tool-result";

export const PROFILE_TOOL_NAMES = ["profile_get", "profile_update", "profile_delete"] as const;

export function createProfileToolHandlers(service: ProfileService) {
  return {
    profile_get: (input: ProfileGetInput) => toolResult(async () => ({ profile: await service.get({
      project: input.project, includeSensitive: input.include_sensitive, includeRaw: input.include_raw,
    }) }), "User profile retrieved."),
    profile_update: (input: ProfileUpdateInput) => toolResult(async () => ({ profile: await service.update({
      project: input.project, operations: profileOperationsFromWire(input.operations),
      expectedRevision: input.expected_revision, operationId: input.operation_id,
    }) }), "User profile updated."),
    profile_delete: (input: ProfileDeleteInput) => toolResult(async () => ({ result: await service.delete({
      project: input.project, expectedRevision: input.expected_revision, operationId: input.operation_id,
    }) }), "User profile logically deleted."),
  };
}

export function registerProfileTools(server: McpServer, service: ProfileService): void {
  const handlers = createProfileToolHandlers(service);
  server.registerTool("profile_get", { description: TOOL_DESCRIPTIONS.profile_get, inputSchema: profileGetInputSchema, annotations: { readOnlyHint: true } }, handlers.profile_get);
  server.registerTool("profile_update", { description: TOOL_DESCRIPTIONS.profile_update, inputSchema: profileUpdateInputSchema }, handlers.profile_update);
  server.registerTool("profile_delete", { description: TOOL_DESCRIPTIONS.profile_delete, inputSchema: profileDeleteInputSchema }, handlers.profile_delete);
}
