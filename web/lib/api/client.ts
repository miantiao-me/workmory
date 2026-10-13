import type {
  AttachmentMetadata,
  MaintenanceProcessResult,
  MaintenanceReindexResult,
  MaintenanceResult,
  MaintenanceStatus,
  ProjectDirectoryResult,
  WorkmoryToolInputMap,
  WorkmoryToolName,
  WorkmoryToolOutputMap,
} from "./types";

const MCP_PROTOCOL_VERSION = "2026-07-28";

interface JsonRpcResponse<T> {
  id?: unknown;
  result?: { structuredContent?: T; isError?: boolean; content?: Array<{ type: string; text?: string }> };
  error?: { code?: string | number; message?: string };
}

interface ErrorBody {
  error?: { code?: string | number; message?: string };
}

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

export interface WorkmoryApiOptions {
  getApiKey: () => string | undefined;
  fetch?: typeof globalThis.fetch;
}

export interface UploadAttachmentInput {
  project: string;
  file: Blob;
  filename: string;
  idempotencyKey: string;
  sha256?: string;
}

function attachmentBase(project: string): string {
  return `/v1/projects/${encodeURIComponent(project)}/attachments`;
}

function safeFilename(filename: string): string {
  return filename.replace(/[\r\n"]/g, "_");
}

async function responseError(response: Response): Promise<ApiError> {
  let body: ErrorBody | undefined;
  try {
    body = await response.clone().json() as ErrorBody;
  } catch {}
  const code = String(body?.error?.code ?? `HTTP_${response.status}`);
  const message = body?.error?.message ?? "The request could not be completed.";
  return new ApiError(code, message, response.status);
}

function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {}
}

function responseCandidates<T>(response: unknown): JsonRpcResponse<T>[] {
  return (Array.isArray(response) ? response : [response])
    .filter((item): item is JsonRpcResponse<T> => item !== null && typeof item === "object");
}

function parseSse<T>(text: string): JsonRpcResponse<T>[] {
  const responses: JsonRpcResponse<T>[] = [];
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line === "data" || line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    const parsed = parseJson<unknown>(data);
    if (parsed !== undefined) responses.push(...responseCandidates<T>(parsed));
  }
  return responses;
}

async function parseMcpResponse<T>(response: Response, id: number): Promise<JsonRpcResponse<T>> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const text = await response.text();
  let responses: JsonRpcResponse<T>[];
  if (contentType === "application/json") {
    const parsed = parseJson<unknown>(text);
    responses = parsed === undefined ? [] : responseCandidates<T>(parsed);
  } else if (contentType === "text/event-stream") {
    responses = parseSse<T>(text);
  } else {
    responses = [];
  }
  const matching = responses.filter((candidate) => candidate.id === id);
  const final = matching.at(-1);
  if (!final) throw new ApiError("INVALID_RESPONSE", "The server returned an invalid response.");
  return final;
}

export function createWorkmoryApi(options: WorkmoryApiOptions) {
  const requestFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  let requestId = 0;

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const key = options.getApiKey();
    if (key) headers.set("X-API-Key", key);
    const response = await requestFetch(path, { ...init, headers });
    if (!response.ok) throw await responseError(response);
    return response;
  }

  async function callTool<Name extends WorkmoryToolName>(
    name: Name,
    args: WorkmoryToolInputMap[Name],
  ): Promise<WorkmoryToolOutputMap[Name]> {
    const id = ++requestId;
    const response = await request("/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        "MCP-Method": "tools/call",
        "MCP-Name": name,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name,
          arguments: args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientInfo": { name: "workmory-web", version: "0.1.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    const payload = await parseMcpResponse<WorkmoryToolOutputMap[Name]>(response, id);
    if (payload.error) {
      throw new ApiError(String(payload.error.code ?? "MCP_ERROR"), payload.error.message ?? "The MCP request failed.");
    }
    if (payload.result?.isError) {
      const error = payload.result.structuredContent as { error?: { code?: string; message?: string } } | undefined;
      throw new ApiError(error?.error?.code ?? "TOOL_ERROR", error?.error?.message ?? "The tool operation failed.");
    }
    if (payload.result?.structuredContent === undefined) {
      throw new ApiError("INVALID_RESPONSE", "The server response did not contain structured content.");
    }
    return payload.result.structuredContent;
  }

  async function maintenanceStatus(): Promise<MaintenanceStatus> {
    const response = await request("/v1/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status" }),
    });
    return response.json() as Promise<MaintenanceStatus>;
  }

  async function maintenanceProcess(): Promise<MaintenanceProcessResult> {
    const response = await request("/v1/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "process" }),
    });
    return response.json() as Promise<MaintenanceProcessResult>;
  }

  async function maintenanceReindex(): Promise<MaintenanceReindexResult> {
    const response = await request("/v1/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reindex" }),
    });
    return response.json() as Promise<MaintenanceReindexResult>;
  }

  async function listProjects(): Promise<ProjectDirectoryResult> {
    const response = await request("/v1/projects", { method: "GET" });
    return response.json() as Promise<ProjectDirectoryResult>;
  }

  async function uploadAttachment(input: UploadAttachmentInput): Promise<AttachmentMetadata> {
    const response = await request(attachmentBase(input.project), {
      method: "POST",
      headers: {
        "Content-Type": input.file.type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeFilename(input.filename)}"; filename*=UTF-8''${encodeURIComponent(input.filename)}`,
        "Idempotency-Key": input.idempotencyKey,
        ...(input.sha256 ? { "X-Content-SHA256": input.sha256 } : {}),
      },
      body: input.file,
    });
    return response.json() as Promise<AttachmentMetadata>;
  }

  async function getAttachment(project: string, id: string): Promise<AttachmentMetadata> {
    const response = await request(`${attachmentBase(project)}/${encodeURIComponent(id)}`);
    return response.json() as Promise<AttachmentMetadata>;
  }

  function attachmentContentPath(project: string, id: string, kind: "original" | "markdown"): string {
    return `${attachmentBase(project)}/${encodeURIComponent(id)}/content/${kind}`;
  }

  async function downloadAttachment(project: string, id: string, kind: "original" | "markdown"): Promise<Blob> {
    return (await request(attachmentContentPath(project, id, kind))).blob();
  }

  async function deleteAttachment(project: string, id: string): Promise<void> {
    await request(`${attachmentBase(project)}/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  return {
    callTool,
    memoryStore: (input: WorkmoryToolInputMap["memory_store"]) => callTool("memory_store", input),
    memoryRetrieve: (input: WorkmoryToolInputMap["memory_retrieve"]) => callTool("memory_retrieve", input),
    memoryHistory: (input: WorkmoryToolInputMap["memory_history"]) => callTool("memory_history", input),
    memoryRetrieveRevision: (input: WorkmoryToolInputMap["memory_retrieve_revision"]) => callTool("memory_retrieve_revision", input),
    memoryRestore: (input: WorkmoryToolInputMap["memory_restore"]) => callTool("memory_restore", input),
    memoryList: (input: WorkmoryToolInputMap["memory_list"]) => callTool("memory_list", input),
    memorySearch: (input: WorkmoryToolInputMap["memory_search"]) => callTool("memory_search", input),
    memoryGraph: (input: WorkmoryToolInputMap["memory_graph"]) => callTool("memory_graph", input),
    memoryDelete: (input: WorkmoryToolInputMap["memory_delete"]) => callTool("memory_delete", input),
    memoryGetLast: (input: WorkmoryToolInputMap["memory_get_last"]) => callTool("memory_get_last", input),
    memoryUpdateLast: (input: WorkmoryToolInputMap["memory_update_last"]) => callTool("memory_update_last", input),
    profileGet: (input: WorkmoryToolInputMap["profile_get"]) => callTool("profile_get", input),
    profileUpdate: (input: WorkmoryToolInputMap["profile_update"]) => callTool("profile_update", input),
    profileDelete: (input: WorkmoryToolInputMap["profile_delete"]) => callTool("profile_delete", input),
    maintenanceStatus,
    maintenanceProcess,
    maintenanceReindex,
    listProjects,
    uploadAttachment,
    getAttachment,
    attachmentContentPath,
    downloadAttachment,
    deleteAttachment,
  };
}
