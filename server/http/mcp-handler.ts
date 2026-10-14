import { createMcpHandler } from "@modelcontextprotocol/server";
import { AuthenticationError } from "../auth/types";
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
    const pathname = new URL(request.url).pathname;
    const match = /^\/mcp(?:\/([^/]+))?\/?$/.exec(pathname);
    if (!match) throw new HttpError(404, "NOT_FOUND", "Route was not found");
    if (request.method === "OPTIONS") {
      const response = preflightResponse("POST, OPTIONS");
      response.headers.set("Allow", "POST, OPTIONS");
      return response;
    }
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });
    let pathApiKey: string | undefined;
    if (match[1] !== undefined) {
      try {
        pathApiKey = decodeURIComponent(match[1]);
      } catch {
        throw new AuthenticationError(401, "AUTH_INVALID", "Authentication failed");
      }
    }
    const authenticated = await authenticatedServices(request, runtime, pathApiKey);
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
