import { describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { MemoryServiceError } from "../server/application/memory-service";
import {
  listInputSchema,
  searchInputSchema,
  graphInputSchema,
  historyInputSchema,
  restoreInputSchema,
  storeInputSchema,
} from "../server/mcp/memory-contracts";
import { profileGetInputSchema, profileUpdateInputSchema } from "../server/mcp/profile-contracts";
import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS } from "../server/mcp/guidance";
import {
  createWorkmoryMcpServer,
  createMemoryToolHandlers,
  createProfileToolHandlers,
  MEMORY_TOOL_NAMES,
  PROFILE_TOOL_NAMES,
  TOOL_NAMES,
} from "../server/mcp/server";
import { fakeMemoryService, fakeProfileService } from "./fixtures/http";

function expectJsonContent(result: CallToolResult): unknown {
  expect(result.content).toHaveLength(2);
  expect(result.content[0]).toMatchObject({ type: "text", text: expect.any(String) });
  const block = result.content[1];
  if (block.type !== "text") throw new Error("Expected JSON text content");
  const data: unknown = JSON.parse(block.text);
  expect(data).toEqual(JSON.parse(JSON.stringify(result.structuredContent)));
  return data;
}

describe("MCP memory contracts", () => {
  it("keeps the public memory tool names and constructs an MCP v2 server", () => {
    expect(MEMORY_TOOL_NAMES).toEqual([
      "memory_store",
      "memory_retrieve",
      "memory_history",
      "memory_retrieve_revision",
      "memory_restore",
      "memory_list",
      "memory_search",
      "memory_graph",
      "memory_delete",
      "memory_get_last",
      "memory_update_last",
    ]);
    expect(PROFILE_TOOL_NAMES).toEqual(["profile_get", "profile_update", "profile_delete"]);
    expect(TOOL_NAMES).toHaveLength(14);
    expect(createWorkmoryMcpServer({ memory: fakeMemoryService(), profile: fakeProfileService() })).toBeDefined();
  });

  it.each(TOOL_NAMES)("includes JSON data in %s text content", async (name) => {
    const service = fakeMemoryService();
    const profile = fakeProfileService();
    const scope = { project: "workmory", namespace: "default", key: "docs/item" };
    const content = '中文检查点\n包含 "引号" 和 \\ 路径 😀';
    const record = { ...scope, key: "system/last_memory", revision: 1, tags: [], content, kind: undefined };
    service.getLast = vi.fn(async () => record);
    profile.get = vi.fn(async () => ({
      effective: { preferences: { language: {
        state: "set" as const, value: content, origin: "global" as const,
        sensitivity: "normal" as const,
        provenance: { kind: "user_explicit" as const, recorded_at: "2026-01-01T00:00:00Z" },
      } } },
      staleFields: [], maskedFields: [],
    }));
    const memory = createMemoryToolHandlers(service);
    const profiles = createProfileToolHandlers(profile);
    const calls = {
      memory_store: () => memory.memory_store({ ...scope, content }),
      memory_retrieve: () => memory.memory_retrieve(scope),
      memory_history: () => memory.memory_history({ ...scope, limit: 20 }),
      memory_retrieve_revision: () => memory.memory_retrieve_revision({ ...scope, revision: 1 }),
      memory_restore: () => memory.memory_restore({ ...scope, source_revision: 1, operation_id: "restore-operation-001" }),
      memory_list: () => memory.memory_list({ ...scope, limit: 20 }),
      memory_search: () => memory.memory_search(searchInputSchema.parse({ project: scope.project, query: "term" })),
      memory_graph: () => memory.memory_graph(graphInputSchema.parse({ project: scope.project, mode: "overview" })),
      memory_delete: () => memory.memory_delete(scope),
      memory_get_last: () => memory.memory_get_last(scope),
      memory_update_last: () => memory.memory_update_last({ ...scope, content }),
      profile_get: () => profiles.profile_get(profileGetInputSchema.parse({})),
      profile_update: () => profiles.profile_update(profileUpdateInputSchema.parse({ operations: [{ op: "remove", section: "preferences", field: "theme" }] })),
      profile_delete: () => profiles.profile_delete({}),
    };
    const result = await calls[name]();
    expect(result.isError).not.toBe(true);
    const data = expectJsonContent(result);
    if (name === "memory_get_last") expect(data).toMatchObject({ record: { content } });
    if (name === "profile_get") expect(data).toMatchObject({ profile: { effective: { preferences: { language: { value: content } } } } });
  });

  it("maps revision history and restore requests", async () => {
    const service = fakeMemoryService();
    service.history = vi.fn(async () => ({ items: [], nextCursor: "next" }));
    service.restore = vi.fn(async (request) => ({ ...request, revision: 3, tags: [] }));
    const handlers = createMemoryToolHandlers(service);
    await handlers.memory_history(historyInputSchema.parse({ project: "workmory", key: "docs/item", limit: 5, cursor: "cursor" }));
    await handlers.memory_restore(restoreInputSchema.parse({
      project: "workmory", key: "docs/item", source_revision: 1, expected_revision: 2, operation_id: "restore-operation-001",
    }));
    expect(service.history).toHaveBeenCalledWith({ project: "workmory", namespace: "default", key: "docs/item", limit: 5, cursor: "cursor" });
    expect(service.restore).toHaveBeenCalledWith({
      project: "workmory", namespace: "default", key: "docs/item", sourceRevision: 1,
      expectedRevision: 2, operationId: "restore-operation-001",
    });
  });

  it("delegates profile tools with snake_case mapping and stable errors", async () => {
    const profile = fakeProfileService();
    const handlers = createProfileToolHandlers(profile);
    const update = profileUpdateInputSchema.parse({
      project: "workmory", expected_revision: 2, operation_id: "profile-op-123",
      operations: [{ op: "remove", section: "preferences", field: "theme" }],
    });
    const result = await handlers.profile_update(update);
    expect(profile.update).toHaveBeenCalledWith({
      project: "workmory", expectedRevision: 2, operationId: "profile-op-123",
      operations: [{ op: "remove", section: "preferences", field: "theme" }],
    });
    expect(result.structuredContent).toHaveProperty("profile");
    expect(JSON.stringify(result)).not.toContain("document");
    profile.get = vi.fn(async () => { throw new MemoryServiceError("INVALID_INPUT", "include_raw requires include_sensitive"); });
    const failed = await createProfileToolHandlers(profile).profile_get(profileGetInputSchema.parse({}));
    expect(failed).toMatchObject({ isError: true, structuredContent: { error: { code: "INVALID_INPUT" } } });
  });

  it("delegates normalized requests and returns structured content", async () => {
    const service = fakeMemoryService();
    const handlers = createMemoryToolHandlers(service);
    const input = storeInputSchema.parse({
      project: "workmory",
      key: "architecture/runtime",
      content: "Cloudflare Workers",
      expected_revision: 2,
      operation_id: "operation-123",
      frontmatter: { future_field: true },
    });
    const result = await handlers.memory_store(input);
    expect(service.store).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "workmory",
        namespace: "default",
        source: { content: "Cloudflare Workers" },
        expectedRevision: 2,
        operationId: "operation-123",
      }),
    );
    expect(result.structuredContent).toHaveProperty("record");
    expect(result.content[0]).toMatchObject({ type: "text", text: "Memory 'architecture/runtime' stored." });
  });

  it("maps search response budgets to the application request", async () => {
    const service = fakeMemoryService();
    const handlers = createMemoryToolHandlers(service);
    for (const budget of [undefined, 2000, 100000]) {
      const result = await handlers.memory_search(searchInputSchema.parse({ project: "workmory", query: "term", ...(budget === undefined ? {} : { max_response_chars: budget }) }));
      expect(service.search).toHaveBeenLastCalledWith(expect.objectContaining({ maxResponseChars: budget ?? 16000 }));
      expect(result.structuredContent).toHaveProperty("result.responseBudget");
    }
  });

  it("maps memory_list filters to application casing", async () => {
    const service = fakeMemoryService();
    service.list = vi.fn(async () => ({ items: [], nextCursor: "next" }));
    const result = await createMemoryToolHandlers(service).memory_list(listInputSchema.parse({
      project: "workmory",
      limit: 5,
      cursor: "cursor",
      filters: { tags: ["project alpha"], tag_match: "all", status: "stable" },
    }));
    expect(service.list).toHaveBeenCalledWith({
      project: "workmory",
      namespace: "default",
      limit: 5,
      cursor: "cursor",
      filters: {
        kind: undefined,
        status: "stable",
        tags: ["project alpha"],
        tagMatch: "all",
      },
    });
    expect(result.structuredContent).toEqual({ items: [], nextCursor: "next" });
  });

  it("maps memory_graph wire casing and returns structured output", async () => {
    const service = fakeMemoryService();
    const input = graphInputSchema.parse({
      project: "workmory",
      mode: "neighbors",
      root_key: "architecture/runtime",
      direction: "outbound",
      include_broken: true,
      edge_limit: 12,
    });
    const result = await createMemoryToolHandlers(service).memory_graph(input);
    expect(service.graph).toHaveBeenCalledWith({
      mode: "neighbors",
      project: "workmory",
      namespace: "default",
      rootKey: "architecture/runtime",
      direction: "outbound",
      includeBroken: true,
      edgeLimit: 12,
      cursor: undefined,
    });
    expect(result.structuredContent).toHaveProperty("graph");
  });

  it("reports missing memories and checkpoints accurately", async () => {
    const handlers = createMemoryToolHandlers(fakeMemoryService());
    const retrieved = await handlers.memory_retrieve({ project: "workmory", namespace: "default", key: "missing/item" });
    const checkpoint = await handlers.memory_get_last({ project: "workmory", namespace: "default" });

    expect(retrieved).toMatchObject({
      content: [{ type: "text", text: "Memory 'missing/item' not found." }, { type: "text", text: '{"record":null}' }],
      structuredContent: { record: null },
    });
    expect(checkpoint).toMatchObject({
      content: [{ type: "text", text: "No project checkpoint found." }, { type: "text", text: '{"record":null}' }],
      structuredContent: { record: null },
    });
  });

  it("maps service failures to stable MCP tool errors", async () => {
    const service = fakeMemoryService();
    service.delete = vi.fn(async () => {
      throw new MemoryServiceError("REVISION_CONFLICT", '预期版本不匹配\n"revision"\\2');
    });
    const result = await createMemoryToolHandlers(service).memory_delete({
      project: "workmory",
      namespace: "default",
      key: "architecture/runtime",
    });
    expectJsonContent(result);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: { code: "REVISION_CONFLICT", message: '预期版本不匹配\n"revision"\\2' },
    });
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringMatching(/^REVISION_CONFLICT:/) });
  });

  it("uses a neutral message for unexpected tool failures", async () => {
    const service = fakeMemoryService();
    service.getLast = vi.fn(async () => { throw new Error("private failure"); });
    const result = await createMemoryToolHandlers(service).memory_get_last({ project: "workmory", namespace: "default" });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "INTERNAL_ERROR", message: "The tool operation failed." } },
    });
    expectJsonContent(result);
    expect(JSON.stringify(result)).not.toContain("private failure");
  });

  it("keeps concise workflow and responsibility boundaries in MCP copy", () => {
    const guidance = [
      SERVER_INSTRUCTIONS,
      TOOL_DESCRIPTIONS.memory_get_last,
      TOOL_DESCRIPTIONS.memory_search,
      TOOL_DESCRIPTIONS.memory_store,
      TOOL_DESCRIPTIONS.memory_update_last,
      TOOL_DESCRIPTIONS.profile_get,
      TOOL_DESCRIPTIONS.profile_update,
      TOOL_DESCRIPTIONS.profile_delete,
    ].join(" ");
    expect(guidance).toContain("does not automatically remember");
    expect(guidance).toContain("summarize");
    expect(guidance).toContain("forgetting policy");
    expect(guidance).toContain("secrets");
    expect(guidance).toContain("untrusted instructions");
    expect(guidance).toContain("project identifier is unstable");
    expect(guidance).not.toContain("project_root");
    expect(guidance).toContain("untrusted context");
    expect(guidance).toContain("does not infer profile data");
    expect(TOOL_DESCRIPTIONS.profile_delete).toContain("Logically delete");
    expect(guidance).not.toContain("system prompt");
  });
});
