import { vi } from "vitest";
import type { MemoryService } from "../../server/application/memory-service";
import type { RuntimeBindings } from "../../server/env";
import type { RequestServices } from "../../server/http/services";
import type { HandlerRuntime } from "../../server/http/runtime";
import type { ProfileService } from "../../server/profile/profile-service";
import type { AccessTokenVerifier } from "../../server/auth/types";

const rootKey = "root-secret-value-that-is-at-least-32-bytes";
const baseEnv = {
  ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
  ACCESS_AUD: "audience",
  EMBEDDING_MODEL: "@cf/qwen/qwen3-embedding-0.6b",
  EMBEDDING_DIMENSIONS: "1024",
  VECTOR_INDEX_VERSION: "v1",
  ROOT_API_KEY: rootKey,
} as unknown as RuntimeBindings;

export function fakeMemoryService(): MemoryService {
  return {
    store: vi.fn(async (request) => ({ ...request, revision: 1, tags: request.tags ?? [] })),
    retrieve: vi.fn(async () => null),
    history: vi.fn(async () => ({ items: [] })),
    retrieveRevision: vi.fn(async (request) => ({
      revision: { revision: request.revision, action: "delete" as const, contentHash: "hash", createdAt: new Date(0).toISOString() },
      record: null,
    })),
    restore: vi.fn(async (request) => ({ ...request, revision: 2, tags: [] })),
    list: vi.fn(async () => ({ items: [] })),
    search: vi.fn(async () => ({ items: [], degraded: false, effectiveSemanticWeight: 0 })),
    graph: vi.fn(async (request) => ({
      mode: request.mode,
      nodes: [],
      edges: [],
      truncated: false,
      truncationReasons: [],
      coverage: { complete: true, pendingSources: 0, truncatedSources: 0 },
    })),
    delete: vi.fn(async (request) => ({ key: request.key, deleted: true })),
    getLast: vi.fn(async () => null),
    updateLast: vi.fn(async (request) => ({ ...request, key: "system/last_memory", revision: 1, tags: [] })),
  };
}

export function fakeProfileService(): ProfileService {
  return {
    get: vi.fn(async () => ({ effective: {}, staleFields: [], maskedFields: [] })),
    update: vi.fn(async () => ({ effective: {}, staleFields: [], maskedFields: [], target: { scope: "global" as const, revision: 1 } })),
    delete: vi.fn(async () => ({ key: "global", scope: "global" as const, revision: 2, deleted: true })),
  };
}

export function runtime(
  services?: Partial<RequestServices>,
  options: { rootOnly?: boolean; accessVerifier?: AccessTokenVerifier } = {},
): HandlerRuntime {
  const defaults = {
    memory: fakeMemoryService(),
    profile: fakeProfileService(),
    attachments: {} as RequestServices["attachments"],
    projectDirectory: { list: vi.fn(async () => ({ projects: [] })) },
    maintenance: async () => ({
      outbox: { claimed: 1, succeeded: 1, failed: 0 },
      vectorCleanup: { claimed: 0, succeeded: 0, failed: 0 },
      canonicalCleanup: { claimed: 0, deleted: 0, failed: 0 },
      attachments: { markedFailed: 0, deleted: 1 },
      graph: { selected: 0, succeeded: 0, failed: 0, stale: 0 },
    }),
  } satisfies RequestServices;
  return {
    env: (options.rootOnly
      ? Object.fromEntries(Object.entries(baseEnv).filter(([key]) => key !== "ACCESS_TEAM_DOMAIN" && key !== "ACCESS_AUD"))
      : baseEnv) as RuntimeBindings,
    defer: () => undefined,
    accessVerifier: options.accessVerifier ?? { verify: async (token) => ({
      issuer: "https://team.cloudflareaccess.com", audience: "audience", subject: token, type: "app",
    }) },
    createServices: () => ({ ...defaults, ...services }),
  };
}

export function headers(extra: HeadersInit = {}): Headers {
  return new Headers({
    "X-API-Key": rootKey,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...Object.fromEntries(new Headers(extra)),
  });
}

export function modernMcpRequest(id: number, method: string, params: Record<string, unknown> = {}, name?: string): Request {
  return new Request("https://api.example.com/mcp", {
    method: "POST",
    headers: headers({
      "MCP-Protocol-Version": "2026-07-28",
      "MCP-Method": method,
      ...(name ? { "MCP-Name": name } : {}),
    }),
    body: JSON.stringify({
      jsonrpc: "2.0", id, method,
      params: { ...params, _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        "io.modelcontextprotocol/clientCapabilities": {},
      } },
    }),
  });
}

export function legacyMcpRequest(id: number, method: string, params: Record<string, unknown> = {}): Request {
  return new Request("https://api.example.com/mcp", {
    method: "POST",
    headers: headers({
      ...(method === "initialize" ? {} : { "MCP-Protocol-Version": "2025-11-25" }),
    }),
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}
