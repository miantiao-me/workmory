import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { retrievalCases, retrievalDocuments } from "../test/evaluation/retrieval-cases.ts";
import { evaluateRanking, summarizeEvaluations } from "../test/evaluation/retrieval-metrics.ts";
import type { MemoryListResult, MemoryRecord, MutationResult, SearchHit, SearchResult } from "../server/domain/memory.ts";

type ToolOutputs = {
  memory_store: { record: MemoryRecord };
  memory_list: MemoryListResult;
  memory_search: { result: SearchResult };
  memory_delete: { result: MutationResult };
};
type Configuration = { baseUrl: string; credential: string; readinessTimeoutMs: number };
type Mode = "lexical" | "semantic" | "hybrid" | "semanticApi";
type Result = ReturnType<typeof evaluateRanking> & {
  id: string; group: string; query: string; intent: string; negative: boolean;
  ranking: { key: string; score: number; ranks: SearchHit["scoreBreakdown"] }[];
  distractorInTop1: boolean | null; distractorInTop5: boolean | null;
  degraded: boolean; degradationCode?: string; coverage: SearchResult["semanticProjectionCoverage"] | null;
};

// Only fixed, locally authored error messages reach the report; remote bodies and fetch errors may contain secrets.
class EvaluationError extends Error {}
function fail(message: string): never { throw new EvaluationError(message); }
const safeError = (error: unknown) => error instanceof EvaluationError ? error.message : "Request or response processing failed";
const project = `retrieval-eval-${Date.now()}-${randomUUID().slice(0, 8)}`;
const scope = { project, namespace: "benchmark" };
const corpusKeys = new Set(retrievalDocuments.map(({ key }) => key));
const attempted: string[] = [];
const revisions = new Map<string, number>();
const modes: Record<Mode, Result[]> = { lexical: [], semantic: [], hybrid: [], semanticApi: [] };
const cleanup = {
  attempted: 0, deleted: 0, remaining: null as number | null, errors: [] as string[],
  activeEmpty: false, qualifiedSemanticEmpty: false,
  semantics: "Logical deletion retains revision/audit history; empty qualified search does not prove physical vector removal.",
};
const report = {
  environment: { baseUrl: null as string | null, project, namespace: scope.namespace,
    embeddingModel: process.env.EMBEDDING_MODEL ?? null,
    embeddingDimensions: process.env.EMBEDDING_DIMENSIONS ?? null },
  startedAt: new Date().toISOString(), finishedAt: "", corpusSize: retrievalDocuments.length,
  semanticView: "Top five API-returned candidates with semanticRank, ordered by semanticRank. This observation removes exact-key boosts and lexical-only candidates; semanticApi preserves the weight=1 API order. Server ranking is unchanged.",
  phase: "configuration", failurePhase: null as string | null, errors: [] as string[],
  readiness: { ready: false, elapsedMs: 0 },
  modes: {} as Record<string, unknown>, cleanup, success: false,
};
let configuration: Configuration | undefined;
let requestId = 0;
function phase(value: string) {
  report.phase = value;
  console.error(value);
}

function parseConfiguration(): Configuration {
  const raw = process.env.RETRIEVAL_BASE_URL;
  if (!raw) fail("RETRIEVAL_BASE_URL must explicitly select an authorized environment");
  const url = (() => {
    try { return new URL(raw); } catch { return fail("RETRIEVAL_BASE_URL must be an origin"); }
  })();
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || !/^https?:\/\/[^/?#]+\/?$/.test(raw)) fail("RETRIEVAL_BASE_URL must contain only an origin without credentials");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?$/.test(raw))) fail("Use HTTPS staging or an explicitly ported localhost HTTP proxy");
  const credential = process.env.ROOT_API_KEY ?? "";
  if (Buffer.byteLength(credential, "utf8") < 32) fail("ROOT_API_KEY must contain at least 32 UTF-8 bytes");
  const requestedWait = Number(process.env.RETRIEVAL_INDEX_TIMEOUT_SECONDS ?? 180);
  if (!Number.isInteger(requestedWait) || requestedWait < 30 || requestedWait > 900) fail("RETRIEVAL_INDEX_TIMEOUT_SECONDS must be an integer between 30 and 900");
  return { baseUrl: url.origin, credential, readinessTimeoutMs: requestedWait * 1000 };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function request(path: string, body?: unknown, deadline?: number, toolName?: string): Promise<unknown> {
  if (!configuration) fail("Request configuration was not initialized");
  const { baseUrl, credential } = configuration;
  const timeout = deadline === undefined ? 30000 : Math.min(30000, deadline - Date.now());
  if (timeout <= 0) fail("Index readiness timeout: full Vectorize visibility was not established");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error",
      headers: { "X-API-Key": credential, "Content-Type": "application/json", Accept: "application/json",
        "User-Agent": "workmory-retrieval-evaluation/1.0",
        ...(toolName ? { "MCP-Protocol-Version": "2026-07-28", "MCP-Method": "tools/call", "MCP-Name": toolName } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    if (deadline !== undefined && Date.now() >= deadline && report.phase === "index-readiness") fail("Index readiness timeout: full Vectorize visibility was not established");
    return fail("Network request failed or timed out");
  }
  if (!response.ok) fail("HTTP request failed");
  try { return await response.json(); } catch { return fail("Response was not valid JSON"); }
}

async function tool<Name extends keyof ToolOutputs>(name: Name, args: Record<string, unknown>, deadline?: number): Promise<ToolOutputs[Name]> {
  const id = ++requestId;
  const envelope = await request("/mcp", {
    jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "retrieval-evaluation", version: "1" },
      "io.modelcontextprotocol/clientCapabilities": {},
    } },
  }, deadline, name);
  if (!isObject(envelope) || envelope.jsonrpc !== "2.0" || envelope.id !== id || envelope.error
    || !isObject(envelope.result) || envelope.result.isError
    || !isObject(envelope.result.structuredContent) || envelope.result.structuredContent.error) fail("MCP tool request failed");
  const output = envelope.result.structuredContent;
  if (name === "memory_store" ? !isObject(output.record)
    : name === "memory_list" ? !Array.isArray(output.items)
    : !isObject(output.result)) fail("Invalid MCP tool output");
  return output as ToolOutputs[Name];
}

function validateSearch(result: SearchResult, weight: number, requireReady: boolean) {
  if (!Array.isArray(result?.items) || result.responseBudget?.omittedItems !== 0) fail("Invalid search response or response budget omissions");
  const seen = new Set<string>();
  for (const item of result.items) {
    const record = item.record;
    if (record?.project !== project || record.namespace !== scope.namespace || !corpusKeys.has(record.key)) fail("Search returned a record outside this run's scope or corpus");
    if (seen.has(record.key) || !Number.isFinite(item.score)) fail("Search returned duplicate keys or invalid scores");
    seen.add(record.key);
    const rank = item.scoreBreakdown?.semanticRank;
    if (rank !== undefined && (!Number.isInteger(rank) || rank < 1)) fail("Search returned an invalid semantic rank");
  }
  if (requireReady && (result.degraded !== false || result.effectiveSemanticWeight !== weight)) fail("Search was degraded or used an unexpected semantic weight");
  if (requireReady && weight > 0 && !completeCoverage(result)) fail("Search semantic projection coverage was incomplete");
}
function completeCoverage(result: SearchResult) {
  const coverage = result.semanticProjectionCoverage;
  return coverage?.complete === true && coverage.eligible === retrievalDocuments.length && coverage.projected === retrievalDocuments.length;
}
async function search(query: string, weight: number, limit: number, deadline?: number): Promise<SearchResult> {
  return (await tool("memory_search", { ...scope, query, semantic_weight: weight, limit, max_response_chars: 100000 }, deadline)).result;
}
async function maintain(deadline: number) {
  if (process.env.RETRIEVAL_ALLOW_MAINTENANCE === "1") await request("/v1/maintenance", { action: "process" }, deadline);
}
function record(mode: Mode, item: typeof retrievalCases[number], response: SearchResult, hits: SearchHit[]) {
  const top = hits.slice(0, 5);
  const keys = top.map(({ record }) => record.key);
  const distractors = item.distractorKeys;
  modes[mode].push({
    ...evaluateRanking(keys, new Set(item.relevantKeys)), id: item.id, group: item.group, query: item.query, intent: item.intent,
    negative: item.group === "negative", ranking: top.map((hit) => ({ key: hit.record.key, score: hit.score, ranks: hit.scoreBreakdown })),
    distractorInTop1: distractors ? keys.slice(0, 1).some((key) => distractors.includes(key)) : null,
    distractorInTop5: distractors ? keys.some((key) => distractors.includes(key)) : null,
    degraded: response.degraded, degradationCode: response.degradationCode, coverage: response.semanticProjectionCoverage ?? null,
  });
}

async function waitForIndex(readinessTimeoutMs: number) {
  const started = Date.now();
  const deadline = started + readinessTimeoutMs;
  do {
    await maintain(deadline);
    const response = await search("project experience notes", 1, 50, deadline);
    validateSearch(response, 1, false);
    const visible = new Set(response.items.filter((hit) => hit.scoreBreakdown?.semanticRank !== undefined).map((hit) => hit.record.key));
    console.error(`index visibility ${visible.size}/${retrievalDocuments.length}; projected ${response.semanticProjectionCoverage?.projected ?? "unknown"}; elapsed ${Math.round((Date.now() - started) / 1000)}s`);
    if (response.degraded === false && response.effectiveSemanticWeight === 1 && completeCoverage(response)
      && [...corpusKeys].every((key) => visible.has(key))) {
      report.readiness = { ready: true, elapsedMs: Date.now() - started };
      break;
    }
    await delay(Math.max(0, Math.min(5000, deadline - Date.now())));
  } while (Date.now() < deadline);
  report.readiness.elapsedMs = Date.now() - started;
  if (!report.readiness.ready) fail("Index readiness timeout: full Vectorize visibility was not established");
}

async function cleanupRun() {
  if (!attempted.length) return;
  phase("cleanup");
  for (const key of attempted) {
    cleanup.attempted++;
    try {
      const deleted = await tool("memory_delete", { ...scope, key, expected_revision: revisions.get(key), operation_id: `${project}-delete-${cleanup.attempted}` });
      if (deleted.result?.deleted !== true) fail("Delete did not confirm logical deletion");
      cleanup.deleted++;
    } catch (error) { cleanup.errors.push(safeError(error)); }
  }
  try {
    const listed = await tool("memory_list", { ...scope, limit: 50 });
    if (!Array.isArray(listed.items)) fail("Cleanup list response was invalid");
    cleanup.remaining = listed.items.length;
    cleanup.activeEmpty = listed.items.length === 0 && !listed.nextCursor;
    if (!cleanup.activeEmpty) fail("Cleanup left active records");
  } catch (error) { cleanup.errors.push(safeError(error)); }
  try {
    const response = await search("project experience notes", 1, 50);
    validateSearch(response, 1, false);
    if (response.degraded !== false || response.effectiveSemanticWeight !== 1) fail("Cleanup semantic verification was degraded");
    if (response.items.length !== 0) fail("Cleanup still returned qualified search results");
    cleanup.qualifiedSemanticEmpty = true;
  } catch (error) { cleanup.errors.push(safeError(error)); }
}

try {
  configuration = parseConfiguration();
  report.environment.baseUrl = configuration.baseUrl;
  if (retrievalDocuments.length > 50 || corpusKeys.size !== retrievalDocuments.length) fail("Corpus must contain at most fifty unique keys");
  phase("preflight");
  const directory = await request("/v1/projects");
  if (!isObject(directory) || !Array.isArray(directory.projects)) fail("Invalid project directory response");
  if (directory.projects.some((entry: unknown) => isObject(entry) && entry.project === project)) fail("Run project already exists");
  const initial = await tool("memory_list", { ...scope, limit: 50 });
  if (!Array.isArray(initial.items) || initial.items.length || initial.nextCursor) fail("Run scope was not empty");
  phase("store");
  for (const document of retrievalDocuments) {
    // Track before the request: a lost response can still represent a committed write.
    attempted.push(document.key);
    const stored = await tool("memory_store", { ...scope, ...document, frontmatter: { type: "Project Experience" },
      expected_revision: 0, operation_id: `${project}-store-${attempted.length}` });
    if (stored.record?.key !== document.key || stored.record.project !== project || stored.record.namespace !== scope.namespace
      || !Number.isInteger(stored.record.revision)) fail("Store returned an invalid record");
    revisions.set(document.key, stored.record.revision);
  }
  phase("index-readiness");
  await waitForIndex(configuration.readinessTimeoutMs);
  phase("evaluate");
  for (const item of retrievalCases) {
    console.error(`query ${item.id}`);
    for (const weight of [0, 0.5, 1]) {
      const response = await search(item.query, weight, weight === 1 ? 50 : 5);
      validateSearch(response, weight, true);
      if (weight === 1) {
        const semantic = response.items.filter((hit) => hit.scoreBreakdown?.semanticRank !== undefined)
          .sort((a, b) => a.scoreBreakdown!.semanticRank! - b.scoreBreakdown!.semanticRank!);
        // With <=50 corpus documents and limit=50 the API cannot truncate the semantic candidate set.
        if (semantic.length !== retrievalDocuments.length) fail("Semantic comparison did not receive the full corpus candidate set");
        record("semantic", item, response, semantic);
        record("semanticApi", item, response, response.items);
      } else record(weight === 0 ? "lexical" : "hybrid", item, response, response.items);
    }
  }
} catch (error) {
  report.failurePhase = report.phase;
  report.errors.push(safeError(error));
} finally {
  await cleanupRun();
  for (const [mode, results] of Object.entries(modes)) {
    report.modes[mode] = { overall: summarizeEvaluations(results),
      groups: Object.fromEntries(["lexical", "paraphrase", "hard", "negative"].map((group) => [group, summarizeEvaluations(results.filter((item) => item.group === group))])),
      negative: { queryCount: results.filter((item) => item.negative).length,
        falsePositiveQueries: results.filter((item) => item.negative && item.keys.length > 0).map((item) => item.id) }, queries: results };
  }
  report.success = report.errors.length === 0 && cleanup.errors.length === 0;
  report.finishedAt = new Date().toISOString();
  if (report.success) report.phase = "complete";
  console.log(JSON.stringify(report, null, 2));
  if (!report.success) process.exitCode = 1;
}
