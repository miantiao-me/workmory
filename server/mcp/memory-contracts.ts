import { z } from "zod";
import { MEMORY_GRAPH_CURSOR_MAX_LENGTH } from "../application/graph-contract";
import { keySchema, kindSchema, memoryScopeSchema, operationIdSchema, revisionSchema, statusSchema, tagSchema } from "../domain/contracts";
import { isRemoteSourceUrl } from "../shared/remote-source-url";

const tagsSchema = z.array(tagSchema).max(32);

export const storeInputSchema = z.object({
  ...memoryScopeSchema,
  key: keySchema,
  content: z.string().min(1).max(1_048_576).optional(),
  okf_markdown: z.string().min(1).max(1_048_576).optional()
    .describe("Complete OKF Markdown document; unknown fields are preserved."),
  attachment_id: z.string().regex(/^att_[a-f0-9]{32}$/, "attachment_id must be an opaque attachment identifier").optional(),
  source_url: z.url().refine(isRemoteSourceUrl, "source_url must use HTTPS on the default port without userinfo").optional()
    .describe("HTTPS source to import; requires operation_id."),
  frontmatter: z.record(z.string(), z.unknown()).optional()
    .describe("Additional OKF frontmatter fields merged last into the stored document."),
  expected_revision: revisionSchema.optional()
    .describe("Require the current revision to match before storing."),
  operation_id: operationIdSchema.optional()
    .describe("Idempotency key for safe retries; reuse only with the identical mutation."),
  kind: kindSchema.optional(),
  tags: tagsSchema.optional(),
  provenance: z.record(z.string(), z.unknown()).optional()
    .describe("OKF provenance fields merged before source and frontmatter fields."),
}).strict().superRefine((value, context) => {
  const sources = [value.content, value.okf_markdown, value.attachment_id, value.source_url];
  if (sources.filter((source) => source !== undefined).length !== 1) {
    context.addIssue({ code: "custom", message: "exactly one of content, okf_markdown, attachment_id, or source_url is required" });
  }
  if (value.source_url !== undefined && value.operation_id === undefined) {
    context.addIssue({ code: "custom", message: "operation_id is required with source_url" });
  }
});

export const retrieveInputSchema = z.object({ ...memoryScopeSchema, key: keySchema }).strict();

export const historyInputSchema = z.object({
  ...memoryScopeSchema,
  key: keySchema,
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();

export const retrieveRevisionInputSchema = z.object({
  ...memoryScopeSchema,
  key: keySchema,
  revision: z.number().int().positive(),
}).strict();

export const restoreInputSchema = z.object({
  ...memoryScopeSchema,
  key: keySchema,
  source_revision: z.number().int().positive(),
  expected_revision: revisionSchema.optional(),
  operation_id: operationIdSchema,
}).strict();

export const listInputSchema = z.object({
  ...memoryScopeSchema,
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
  filters: z.object({
    kind: kindSchema.optional(),
    status: statusSchema.optional(),
    tags: tagsSchema.optional(),
    tag_match: z.enum(["any", "all"]).default("any"),
  }).strict().optional(),
}).strict();

export const searchInputSchema = z.object({
  ...memoryScopeSchema,
  query: z.string().min(1).max(2_000),
  max_response_chars: z.number().int().min(2_000).max(100_000).default(16_000)
    .describe("Maximum JSON.stringify(SearchResult).length in UTF-16 code units, including metadata; excludes transport envelopes."),
  semantic_weight: z.number().min(0).max(1).default(0.5),
  limit: z.number().int().min(1).max(50).default(20),
  filters: z.object({
    kind: kindSchema.optional(),
    tags: tagsSchema.optional(),
    status: statusSchema.optional(),
  }).strict().optional(),
}).strict();

export const deleteInputSchema = z.object({
  ...memoryScopeSchema,
  key: keySchema,
  expected_revision: revisionSchema.optional()
    .describe("Require the current revision to match before deleting."),
  operation_id: operationIdSchema.optional()
    .describe("Idempotency key for safe retries; reuse only with the identical mutation."),
}).strict();

export const getLastInputSchema = z.object(memoryScopeSchema).strict();

export const updateLastInputSchema = z.object({
  ...memoryScopeSchema,
  content: z.string().min(1).max(1_048_576),
  summary: z.string().min(1).max(500).optional(),
  expected_revision: revisionSchema.optional()
    .describe("Require the current checkpoint revision to match before updating."),
  operation_id: operationIdSchema.optional()
    .describe("Idempotency key for safe retries; reuse only with the identical mutation."),
}).strict();

const graphCursorSchema = z.string().min(1).max(MEMORY_GRAPH_CURSOR_MAX_LENGTH).regex(/^[A-Za-z0-9_-]+$/).optional();

export const graphInputSchema = z.discriminatedUnion("mode", [
  z.object({
    ...memoryScopeSchema,
    mode: z.literal("overview"),
    node_limit: z.number().int().min(1).max(200).default(50),
    edge_limit: z.number().int().min(1).max(400).default(100),
    cursor: graphCursorSchema,
  }).strict(),
  z.object({
    ...memoryScopeSchema,
    mode: z.literal("neighbors"),
    root_key: keySchema,
    direction: z.enum(["outbound", "inbound", "both"]).default("both"),
    include_broken: z.boolean().default(false),
    edge_limit: z.number().int().min(1).max(400).default(100),
    cursor: graphCursorSchema,
  }).strict(),
]);

export type StoreInput = z.infer<typeof storeInputSchema>;
export type RetrieveInput = z.infer<typeof retrieveInputSchema>;
export type HistoryInput = z.infer<typeof historyInputSchema>;
export type RetrieveRevisionInput = z.infer<typeof retrieveRevisionInputSchema>;
export type RestoreInput = z.infer<typeof restoreInputSchema>;
export type ListInput = z.infer<typeof listInputSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
export type DeleteInput = z.infer<typeof deleteInputSchema>;
export type GetLastInput = z.infer<typeof getLastInputSchema>;
export type UpdateLastInput = z.infer<typeof updateLastInputSchema>;
export type GraphInput = z.infer<typeof graphInputSchema>;
