import { describe, expect, it, vi } from "vitest";
import { MemoryServiceError } from "../server/application/memory-service";
import type { ActorContext } from "../server/domain/identity";
import { handleMcpRequest } from "../server/http/mcp-handler";
import { fakeMemoryService, headers, legacyMcpRequest, modernMcpRequest, runtime } from "./fixtures/http";

interface ListedTool {
  name: string;
  annotations?: { readOnlyHint?: boolean };
}

const READ_ONLY_TOOLS = new Set(["memory_retrieve", "memory_history", "memory_retrieve_revision", "memory_list", "memory_search", "memory_graph", "memory_get_last", "profile_get"]);

function expectReadOnlyAnnotations(tools: ListedTool[]): void {
  expect(tools).toHaveLength(14);
  for (const tool of tools) {
    if (READ_ONLY_TOOLS.has(tool.name)) expect(tool.annotations?.readOnlyHint).toBe(true);
    else expect(tool.annotations?.readOnlyHint).not.toBe(true);
  }
}

function mcpMessageRequest(body: unknown, extraHeaders: HeadersInit = {}): Request {
  return new Request("https://api.example.com/mcp", {
    method: "POST",
    headers: headers(extraHeaders),
    body: JSON.stringify(body),
  });
}

async function expectAcceptedWithoutBody(response: Response): Promise<void> {
  expect(response.status).toBe(202);
  expect(await response.text()).toBe("");
  expect(response.headers.has("mcp-session-id")).toBe(false);
}

async function legacyResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  return JSON.parse(data ?? text);
}

describe("modern per-request MCP HTTP", () => {
  it("handles discover, tools/list, and tools/call on independent POST requests", async () => {
    const initialized = await handleMcpRequest(modernMcpRequest(1, "server/discover"), runtime());
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get("content-type")).toContain("application/json");
    expect((await initialized.json() as { result: { supportedVersions: string[] } }).result.supportedVersions).toContain("2026-07-28");
    expect(initialized.headers.has("mcp-session-id")).toBe(false);
    const listed = await handleMcpRequest(modernMcpRequest(2, "tools/list"), runtime());
    expectReadOnlyAnnotations((await listed.json() as { result: { tools: ListedTool[] } }).result.tools);
    expect(listed.headers.has("mcp-session-id")).toBe(false);
    const called = await handleMcpRequest(
      modernMcpRequest(3, "tools/call", { name: "memory_get_last", arguments: { project: "workmory" } }, "memory_get_last"), runtime(),
    );
    expect((await called.json() as { result: { structuredContent: unknown } }).result.structuredContent).toBeDefined();
  });

  it("serves the 2025-11-25 Streamable HTTP fallback as stateless POSTs", async () => {
    const initialized = await handleMcpRequest(legacyMcpRequest(7, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "legacy-test", version: "1" },
    }), runtime());
    expect(initialized.status).toBe(200);
    expect((await legacyResponseJson(initialized) as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-11-25");
    expect(initialized.headers.has("mcp-session-id")).toBe(false);

    const listed = await handleMcpRequest(legacyMcpRequest(8, "tools/list"), runtime());
    expect(listed.status).toBe(200);
    expectReadOnlyAnnotations((await legacyResponseJson(listed) as { result: { tools: ListedTool[] } }).result.tools);
    expect(listed.headers.has("mcp-session-id")).toBe(false);
  });

  it("accepts modern and legacy notifications and legacy JSON-RPC responses without sessions", async () => {
    await expectAcceptedWithoutBody(await handleMcpRequest(mcpMessageRequest({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: { _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        "io.modelcontextprotocol/clientCapabilities": {},
      } },
    }, {
      "MCP-Protocol-Version": "2026-07-28",
      "MCP-Method": "notifications/initialized",
    }), runtime()));

    for (const body of [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 41, result: {} },
    ]) {
      await expectAcceptedWithoutBody(await handleMcpRequest(mcpMessageRequest(body, {
        "MCP-Protocol-Version": "2025-11-25",
      }), runtime()));
    }
  });

  it("rejects a client JSON-RPC response carrying a modern protocol claim", async () => {
    const response = await handleMcpRequest(mcpMessageRequest({ jsonrpc: "2.0", id: 42, result: {} }, {
      "MCP-Protocol-Version": "2026-07-28",
    }), runtime());
    expect(response.status).toBe(400);
    expect(response.headers.has("mcp-session-id")).toBe(false);
    expect(await response.json()).toMatchObject({
      error: { code: -32000, message: expect.stringContaining("Unsupported protocol version: 2026-07-28") },
      id: null,
    });
  });

  it("authenticates legacy fallback requests before protocol handling", async () => {
    const request = legacyMcpRequest(9, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "legacy-test", version: "1" },
    });
    request.headers.delete("x-api-key");
    const response = await handleMcpRequest(request, runtime());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTH_REQUIRED", message: "Authentication is required" } });
  });

  it("keeps business failures as MCP isError results", async () => {
    const memory = fakeMemoryService();
    memory.delete = vi.fn(async () => { throw new MemoryServiceError("REVISION_CONFLICT", "changed"); });
    const response = await handleMcpRequest(
      modernMcpRequest(4, "tools/call", { name: "memory_delete", arguments: { project: "workmory", key: "a/b" } }, "memory_delete"),
      runtime({ memory }),
    );
    expect((await response.json() as { result: { isError: boolean } }).result.isError).toBe(true);
  });

  it("returns 405 for GET/DELETE and minimal CORS for allowed OPTIONS", async () => {
    for (const method of ["GET", "DELETE"]) {
      expect((await handleMcpRequest(new Request("https://api.example.com/mcp", { method }), runtime())).status).toBe(405);
    }
    const options = await handleMcpRequest(
      new Request("https://api.example.com/mcp", { method: "OPTIONS", headers: { Origin: "https://api.example.com" } }), runtime(),
    );
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns wildcard CORS while authentication still rejects missing, ambiguous, and cookie credentials", async () => {
    const requests = [
      new Request("http://arbitrary.example/mcp", { method: "POST" }),
      new Request("http://arbitrary.example/mcp", {
        method: "POST",
        headers: { Authorization: "Bearer token", "X-API-Key": "also-present" },
      }),
      new Request("http://arbitrary.example/mcp", { method: "POST", headers: { Cookie: "CF_Authorization=token" } }),
    ];
    const expected = [401, 400, 400];
    for (const [index, request] of requests.entries()) {
      const response = await handleMcpRequest(request, runtime());
      expect(response.status).toBe(expected[index]);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("keeps the authenticated parent-session owner across an arbitrary HTTP host and origin", async () => {
    const request = modernMcpRequest(10, "tools/list");
    request.headers.delete("x-api-key");
    request.headers.set("authorization", "Bearer parent-session");
    request.headers.set("origin", "http://arbitrary-browser.example");
    const crossOriginRequest = new Request("http://arbitrary-host.example/mcp", {
      method: "POST",
      headers: request.headers,
      body: await request.text(),
    });
    const handlerRuntime = runtime();
    const createServices = handlerRuntime.createServices!;
    let actor: ActorContext | undefined;
    handlerRuntime.createServices = (authenticatedActor) => {
      actor = authenticatedActor;
      return createServices(authenticatedActor);
    };

    const response = await handleMcpRequest(crossOriginRequest, handlerRuntime);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(actor).toMatchObject({ authKind: "access" });
    expect((actor as unknown as ActorContext).ownerId).toMatch(/^access_[a-f0-9]{32}$/);
  });

  it("supports root-only startup and fails closed for Access credentials", async () => {
    const verify = vi.fn(async () => { throw new Error("must not run"); });
    const rootOnly = runtime(undefined, { rootOnly: true, accessVerifier: { verify } });
    const rooted = await handleMcpRequest(modernMcpRequest(5, "tools/list"), rootOnly);
    expect(rooted.status).toBe(200);
    expect(verify).not.toHaveBeenCalled();

    const bearer = modernMcpRequest(6, "tools/list");
    bearer.headers.delete("x-api-key");
    bearer.headers.set("authorization", "Bearer token");
    const response = await handleMcpRequest(bearer, rootOnly);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "AUTH_CONFIG_INVALID", message: "Access authentication is not configured" },
    });
    expect(verify).not.toHaveBeenCalled();
  });
});
