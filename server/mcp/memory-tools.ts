import type { McpServer } from "@modelcontextprotocol/server";
import type { MemoryService } from "../application/memory-service";
import {
  deleteInputSchema,
  getLastInputSchema,
  graphInputSchema,
  historyInputSchema,
  listInputSchema,
  retrieveInputSchema,
  retrieveRevisionInputSchema,
  restoreInputSchema,
  searchInputSchema,
  storeInputSchema,
  updateLastInputSchema,
  type DeleteInput,
  type GetLastInput,
  type GraphInput,
  type HistoryInput,
  type ListInput,
  type RetrieveInput,
  type RetrieveRevisionInput,
  type RestoreInput,
  type SearchInput,
  type StoreInput,
  type UpdateLastInput,
} from "./memory-contracts";
import { TOOL_DESCRIPTIONS } from "./guidance";
import { toolResult } from "./tool-result";

export const MEMORY_TOOL_NAMES = [
  "memory_store", "memory_retrieve", "memory_history", "memory_retrieve_revision", "memory_restore", "memory_list", "memory_search", "memory_graph", "memory_delete", "memory_get_last", "memory_update_last",
] as const;

function storeSource(input: StoreInput) {
  if (input.content !== undefined) return { content: input.content } as const;
  if (input.okf_markdown !== undefined) return { okf_markdown: input.okf_markdown } as const;
  if (input.attachment_id !== undefined) return { attachment_id: input.attachment_id } as const;
  return { source_url: input.source_url! } as const;
}

export function createMemoryToolHandlers(service: MemoryService) {
  return {
    memory_store: (input: StoreInput) => toolResult(async () => ({ record: await service.store({
      project: input.project, namespace: input.namespace, key: input.key, source: storeSource(input),
      frontmatter: input.frontmatter, kind: input.kind, tags: input.tags, provenance: input.provenance,
      expectedRevision: input.expected_revision, operationId: input.operation_id,
    }) }), `Memory '${input.key}' stored.`),
    memory_retrieve: (input: RetrieveInput) => toolResult(
      async () => ({ record: await service.retrieve(input) }),
      (data) => data.record === null ? `Memory '${input.key}' not found.` : `Memory '${input.key}' retrieved.`,
    ),
    memory_history: (input: HistoryInput) => toolResult(async () => ({ ...await service.history({
      project: input.project, namespace: input.namespace, key: input.key, limit: input.limit, cursor: input.cursor,
    }) }), `History for memory '${input.key}' listed.`),
    memory_retrieve_revision: (input: RetrieveRevisionInput) => toolResult(async () => ({ result: await service.retrieveRevision({
      project: input.project, namespace: input.namespace, key: input.key, revision: input.revision,
    }) }), `Revision ${input.revision} of memory '${input.key}' retrieved.`),
    memory_restore: (input: RestoreInput) => toolResult(async () => ({ record: await service.restore({
      project: input.project, namespace: input.namespace, key: input.key, sourceRevision: input.source_revision,
      expectedRevision: input.expected_revision, operationId: input.operation_id,
    }) }), `Memory '${input.key}' restored from revision ${input.source_revision}.`),
    memory_list: (input: ListInput) => toolResult(async () => ({ ...await service.list({
      project: input.project,
      namespace: input.namespace,
      limit: input.limit,
      cursor: input.cursor,
      filters: input.filters === undefined ? undefined : {
        kind: input.filters.kind,
        status: input.filters.status,
        tags: input.filters.tags,
        tagMatch: input.filters.tag_match,
      },
    }) }), "Memories listed."),
    memory_search: (input: SearchInput) => toolResult(async () => ({ result: await service.search({
      project: input.project, namespace: input.namespace, query: input.query,
      semanticWeight: input.semantic_weight, limit: input.limit, filters: input.filters, maxResponseChars: input.max_response_chars,
    }) }), "Memory search completed."),
    memory_graph: (input: GraphInput) => toolResult(async () => ({ graph: await service.graph(input.mode === "overview" ? {
      mode: "overview",
      project: input.project,
      namespace: input.namespace,
      nodeLimit: input.node_limit,
      edgeLimit: input.edge_limit,
      cursor: input.cursor,
    } : {
      mode: "neighbors",
      project: input.project,
      namespace: input.namespace,
      rootKey: input.root_key,
      direction: input.direction,
      includeBroken: input.include_broken,
      edgeLimit: input.edge_limit,
      cursor: input.cursor,
    }) }), "Memory graph retrieved."),
    memory_delete: (input: DeleteInput) => toolResult(async () => ({ result: await service.delete({
      project: input.project, namespace: input.namespace, key: input.key,
      expectedRevision: input.expected_revision, operationId: input.operation_id,
    }) }), `Memory '${input.key}' logically deleted.`),
    memory_get_last: (input: GetLastInput) => toolResult(
      async () => ({ record: await service.getLast(input) }),
      (data) => data.record === null ? "No project checkpoint found." : "Project checkpoint retrieved.",
    ),
    memory_update_last: (input: UpdateLastInput) => toolResult(async () => ({ record: await service.updateLast({
      project: input.project, namespace: input.namespace, content: input.content, summary: input.summary,
      expectedRevision: input.expected_revision, operationId: input.operation_id,
    }) }), "Project checkpoint updated."),
  };
}

export function registerMemoryTools(server: McpServer, service: MemoryService): void {
  const handlers = createMemoryToolHandlers(service);
  server.registerTool("memory_store", { description: TOOL_DESCRIPTIONS.memory_store, inputSchema: storeInputSchema }, handlers.memory_store);
  server.registerTool("memory_retrieve", { description: TOOL_DESCRIPTIONS.memory_retrieve, inputSchema: retrieveInputSchema, annotations: { readOnlyHint: true } }, handlers.memory_retrieve);
  server.registerTool("memory_history", { description: TOOL_DESCRIPTIONS.memory_history, inputSchema: historyInputSchema, annotations: { readOnlyHint: true } }, handlers.memory_history);
  server.registerTool("memory_retrieve_revision", { description: TOOL_DESCRIPTIONS.memory_retrieve_revision, inputSchema: retrieveRevisionInputSchema, annotations: { readOnlyHint: true } }, handlers.memory_retrieve_revision);
  server.registerTool("memory_restore", { description: TOOL_DESCRIPTIONS.memory_restore, inputSchema: restoreInputSchema }, handlers.memory_restore);
  server.registerTool("memory_list", { description: TOOL_DESCRIPTIONS.memory_list, inputSchema: listInputSchema, annotations: { readOnlyHint: true } }, handlers.memory_list);
  server.registerTool("memory_search", { description: TOOL_DESCRIPTIONS.memory_search, inputSchema: searchInputSchema, annotations: { readOnlyHint: true } }, handlers.memory_search);
  server.registerTool("memory_graph", { description: TOOL_DESCRIPTIONS.memory_graph, inputSchema: graphInputSchema, annotations: { readOnlyHint: true } }, handlers.memory_graph);
  server.registerTool("memory_delete", { description: TOOL_DESCRIPTIONS.memory_delete, inputSchema: deleteInputSchema }, handlers.memory_delete);
  server.registerTool("memory_get_last", { description: TOOL_DESCRIPTIONS.memory_get_last, inputSchema: getLastInputSchema, annotations: { readOnlyHint: true } }, handlers.memory_get_last);
  server.registerTool("memory_update_last", { description: TOOL_DESCRIPTIONS.memory_update_last, inputSchema: updateLastInputSchema }, handlers.memory_update_last);
}
