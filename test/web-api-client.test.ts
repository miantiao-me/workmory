import { describe, expect, it, vi } from "vitest";
import { ApiError, createWorkmoryApi } from "../web/lib/api/client";

describe("browser API client", () => {
  it("injects the current key and sends the modern MCP tools/call contract", async () => {
    let key = "first-key";
    const fetch = vi.fn(async (_path: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { structuredContent: { record: null } },
      }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    });
    const api = createWorkmoryApi({ getApiKey: () => key, fetch: fetch as typeof globalThis.fetch });

    await api.memoryGetLast({ project: "workmory", namespace: "default" });
    key = "second-key";
    await api.profileGet({ include_sensitive: false, include_raw: false });

    const first = fetch.mock.calls[0];
    const second = fetch.mock.calls[1];
    expect(first[0]).toBe("/mcp");
    expect(new Headers(first[1]?.headers).get("X-API-Key")).toBe("first-key");
    expect(new Headers(second[1]?.headers).get("X-API-Key")).toBe("second-key");
    expect(new Headers(first[1]?.headers).get("MCP-Protocol-Version")).toBe("2026-07-28");
    expect(JSON.parse(String(first[1]?.body))).toMatchObject({
      id: 1,
      method: "tools/call",
      params: { name: "memory_get_last", arguments: { project: "workmory" } },
    });
  });

  it("turns tool errors into safe display errors", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { isError: true, structuredContent: { error: { code: "REVISION_CONFLICT", message: "Memory changed" } } },
    }), { headers: { "Content-Type": "application/json" } })) as typeof globalThis.fetch;
    const api = createWorkmoryApi({ getApiKey: () => "never-returned", fetch });
    await expect(api.memoryDelete({ project: "workmory", namespace: "default", key: "a/b" }))
      .rejects.toEqual(expect.objectContaining({ name: "ApiError", code: "REVISION_CONFLICT", message: "Memory changed" }));
  });

  it("calls memory_graph through the stateless MCP endpoint", async () => {
    const fetch = vi.fn(async (_path: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { structuredContent: { graph: { nodes: [], edges: [] } } } }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const api = createWorkmoryApi({ getApiKey: () => "key", fetch: fetch as typeof globalThis.fetch });
    await api.memoryGraph({ project: "workmory", namespace: "default", mode: "overview", node_limit: 50, edge_limit: 100 });
    expect(fetch.mock.calls[0][0]).toBe("/mcp");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      method: "tools/call",
      params: { name: "memory_graph", arguments: { mode: "overview", node_limit: 50, edge_limit: 100 } },
    });
  });

  it("maps revision history, retrieval, and restore tool calls", async () => {
    const fetch = vi.fn(async (_path: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { structuredContent: {} } }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const api = createWorkmoryApi({ getApiKey: () => "key", fetch: fetch as typeof globalThis.fetch });
    await api.memoryHistory({ project: "workmory", namespace: "default", key: "docs/item", limit: 10 });
    await api.memoryRetrieveRevision({ project: "workmory", namespace: "default", key: "docs/item", revision: 2 });
    await api.memoryRestore({ project: "workmory", namespace: "default", key: "docs/item", source_revision: 1, operation_id: "restore-operation-001" });
    expect(fetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).params.name)).toEqual([
      "memory_history", "memory_retrieve_revision", "memory_restore",
    ]);
  });

  it("selects the matching final response after SSE notifications and progress", async () => {
    const body = [
      "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{}}",
      "",
      "data: {\"jsonrpc\":\"2.0\",\"id\":99,\"result\":{}}",
      "",
      "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"structuredContent\":{\"record\":\"final\"}}}",
      "",
    ].join("\n");
    const fetch = vi.fn(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })) as typeof globalThis.fetch;
    const api = createWorkmoryApi({ getApiKey: () => "key", fetch });
    await expect(api.memoryGetLast({ project: "workmory", namespace: "default" }))
      .resolves.toEqual({ record: "final" });
  });

  it("parses CRLF SSE events with multiple data lines", async () => {
    const body = [
      "event: message",
      "data: {\"jsonrpc\":\"2.0\",",
      "data: \"id\":1,\"result\":{\"structuredContent\":{\"profile\":{}}}}",
      "",
    ].join("\r\n");
    const fetch = vi.fn(async () => new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } })) as typeof globalThis.fetch;
    const api = createWorkmoryApi({ getApiKey: () => "key", fetch });
    await expect(api.profileGet({ include_sensitive: false, include_raw: false }))
      .resolves.toEqual({ profile: {} });
  });

  it("turns a matching SSE JSON-RPC error into a safe API error", async () => {
    const body = "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32603,\"message\":\"Request failed\"}}\n\n";
    const fetch = vi.fn(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })) as typeof globalThis.fetch;
    const api = createWorkmoryApi({ getApiKey: () => "key", fetch });
    await expect(api.memoryList({ project: "workmory", namespace: "default", limit: 20 }))
      .rejects.toEqual(expect.objectContaining({ code: "-32603", message: "Request failed" }));
  });

  it("rejects JSON without a response matching the request id", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      jsonrpc: "2.0", id: 2, result: { structuredContent: { record: null } },
    }), { headers: { "Content-Type": "application/json" } })) as typeof globalThis.fetch;
    const api = createWorkmoryApi({ getApiKey: () => "key", fetch });
    await expect(api.memoryGetLast({ project: "workmory", namespace: "default" }))
      .rejects.toEqual(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });

  it("implements maintenance and attachment request contracts", async () => {
    const fetch = vi.fn(async (_path: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ id: `att_${"a".repeat(32)}` }), { headers: { "Content-Type": "application/json" } });
    });
    let key = "initial-key";
    const api = createWorkmoryApi({ getApiKey: () => key, fetch: fetch as typeof globalThis.fetch });
    await api.maintenanceReindex();
    await api.uploadAttachment({
      project: "my project",
      file: new Blob(["body"], { type: "text/plain" }),
      filename: "note.txt",
      idempotencyKey: "upload-1",
      sha256: "hash",
    });
    const id = `att_${"a".repeat(32)}`;
    key = "current-key";
    await api.downloadAttachment("my project", id, "markdown");
    await api.deleteAttachment("my project", id);

    expect(fetch.mock.calls[0][0]).toBe("/v1/maintenance");
    expect(fetch.mock.calls[0][1]?.body).toBe(JSON.stringify({ action: "reindex" }));
    expect(fetch.mock.calls[1][0]).toBe("/v1/projects/my%20project/attachments");
    const uploadHeaders = new Headers(fetch.mock.calls[1][1]?.headers);
    expect(uploadHeaders.get("Idempotency-Key")).toBe("upload-1");
    expect(uploadHeaders.get("X-Content-SHA256")).toBe("hash");
    expect(fetch.mock.calls[2][0]).toContain(`/content/markdown`);
    expect(new Headers(fetch.mock.calls[2][1]?.headers).get("X-API-Key")).toBe("current-key");
    expect(fetch.mock.calls[3][1]?.method).toBe("DELETE");
  });

  it("lists the project directory with the current key", async () => {
    const result = { projects: [{ project: "workmory", namespaces: ["default", "notes"] }] };
    const fetch = vi.fn(async (_path: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } }));
    const api = createWorkmoryApi({ getApiKey: () => "directory-key", fetch: fetch as typeof globalThis.fetch });

    await expect(api.listProjects()).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe("/v1/projects");
    expect(fetch.mock.calls[0][1]?.method).toBe("GET");
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("X-API-Key")).toBe("directory-key");
  });

  it("rejects project directory error responses", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      error: { code: "AUTH_INVALID", message: "Invalid credentials" },
    }), { status: 401, headers: { "Content-Type": "application/json" } })) as typeof globalThis.fetch;
    const api = createWorkmoryApi({ getApiKey: () => "rejected-key", fetch });

    await expect(api.listProjects()).rejects.toEqual(expect.objectContaining({
      name: "ApiError",
      code: "AUTH_INVALID",
      message: "Invalid credentials",
      status: 401,
    }));
  });

  it("does not expose a key through HTTP errors", async () => {
    const fetch = vi.fn(async () => new Response("not json", { status: 500 })) as typeof globalThis.fetch;
    const api = createWorkmoryApi({ getApiKey: () => "secret-key", fetch });
    const error = await api.maintenanceStatus().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(String(error)).not.toContain("secret-key");
  });
});
