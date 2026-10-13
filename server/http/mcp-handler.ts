import { createMcpHandler } from "@modelcontextprotocol/server";
import { createWorkmoryMcpServer } from "../mcp/server";
import { authenticatedServices } from "./authenticated";
import { HttpError } from "./errors";
import { handleRequest } from "./handler";
import { readBoundedJson } from "./read-bounded-json";
import { preflightResponse } from "./security";
import type { HandlerRuntime } from "./runtime";

const MAX_MCP_BODY_BYTES = 2 * 1024 * 1024;
const MAX_MCP_BATCH_SIZE = 32;

async function readMcpBody(request: Request): Promise<unknown> {
  if (!request.body) throw new HttpError(400, "MCP_BODY_REQUIRED", "MCP request body is required");
  const body = await readBoundedJson(request, {
    maxBytes: MAX_MCP_BODY_BYTES,
    tooLarge: { status: 413, code: "MCP_BODY_TOO_LARGE", message: "MCP request body exceeds 2 MiB" },
    parseError: { status: 400, code: "MCP_PARSE_ERROR", message: "MCP request body is not valid JSON" },
  });
  if (Array.isArray(body) && body.length > MAX_MCP_BATCH_SIZE) {
    throw new HttpError(400, "MCP_BATCH_TOO_LARGE", "MCP JSON-RPC batch exceeds 32 entries");
  }
  return body;
}

export async function handleMcpRequest(request: Request, runtime: HandlerRuntime): Promise<Response> {
  return handleRequest("/mcp", async () => {
    if (request.method === "OPTIONS") return preflightResponse("POST, OPTIONS");
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });
    const authenticated = await authenticatedServices(request, runtime);
    const parsedBody = await readMcpBody(request);
    const handler = createMcpHandler(() => createWorkmoryMcpServer({
      memory: authenticated.services.memory,
      profile: authenticated.services.profile,
    }), {
      legacy: "stateless",
    });
    return handler.fetch(request, { parsedBody });
  });
}
