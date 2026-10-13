import { McpServer } from "@modelcontextprotocol/server";
import type { MemoryService } from "../application/memory-service";
import type { ProfileService } from "../profile/profile-service";
import { SERVER_INSTRUCTIONS } from "./guidance";
import { MEMORY_TOOL_NAMES, registerMemoryTools } from "./memory-tools";
import { PROFILE_TOOL_NAMES, registerProfileTools } from "./profile-tools";

export { createMemoryToolHandlers, MEMORY_TOOL_NAMES } from "./memory-tools";
export { createProfileToolHandlers, PROFILE_TOOL_NAMES } from "./profile-tools";

export const TOOL_NAMES = [...MEMORY_TOOL_NAMES, ...PROFILE_TOOL_NAMES] as const;

export interface McpServices {
  memory: MemoryService;
  profile: ProfileService;
}

export function createWorkmoryMcpServer(services: McpServices): McpServer {
  const server = new McpServer(
    { name: "workmory", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  registerMemoryTools(server, services.memory);
  registerProfileTools(server, services.profile);
  return server;
}
