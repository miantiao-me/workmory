import { extractMemoryLinks, MEMORY_LINK_EXTRACTOR_VERSION } from "../domain/memory-links";
import { parseOkf } from "../domain/okf";
import type { ImmutableObjectStore } from "../storage/r2-object-store";
import { memoryLinkInsertStatements } from "./memory-link-statements";

const MAX_GRAPH_INDEX_BATCH = 10;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 60 * 60 * 1_000;

interface GraphCandidate {
  memoryId: string;
  projectId: string;
  namespace: string;
  key: string;
  revision: number;
  objectKey: string;
  contentHash: string;
  stateVersion: string;
  stateStatus: "pending" | "failed" | "complete";
}

export interface GraphIndexProcessResult {
  selected: number;
  succeeded: number;
  failed: number;
  stale: number;
}

function candidateGuard(): string {
  return `EXISTS (
    SELECT 1 FROM memories m JOIN memory_link_index i ON i.memory_id = m.id
    WHERE m.id = ? AND m.current_revision = ? AND m.current_object_key = ? AND m.current_hash = ?
      AND m.deleted = 0 AND m.indexable = 1 AND i.revision = ?
      AND i.extractor_version = ? AND i.status = 'pending' AND i.next_attempt_at <= ?
  )`;
}

function guardBindings(candidate: GraphCandidate, extractorVersion: string, now: number): unknown[] {
  return [candidate.memoryId, candidate.revision, candidate.objectKey, candidate.contentHash, candidate.revision, extractorVersion, now];
}

async function markCandidatePending(db: D1Database, candidate: GraphCandidate, extractorVersion: string, now: number): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE memory_link_index SET extractor_version = ?, status = 'pending', truncated = 0,
       attempts = CASE WHEN extractor_version = ? THEN attempts ELSE 0 END, next_attempt_at = ?
     WHERE memory_id = ? AND revision = ? AND extractor_version = ? AND status = ?
       AND EXISTS (SELECT 1 FROM memories m WHERE m.id = memory_link_index.memory_id
         AND m.current_revision = ? AND m.current_object_key = ? AND m.current_hash = ?
         AND m.deleted = 0 AND m.indexable = 1)
       AND (extractor_version <> ? OR next_attempt_at <= ?)`,
  ).bind(
    extractorVersion,
    extractorVersion,
    now,
    candidate.memoryId,
    candidate.revision,
    candidate.stateVersion,
    candidate.stateStatus,
    candidate.revision,
    candidate.objectKey,
    candidate.contentHash,
    extractorVersion,
    now,
  ).run();
  return (result.meta.changes ?? 0) === 1;
}

async function completeCandidate(
  db: D1Database,
  candidate: GraphCandidate,
  extraction: ReturnType<typeof extractMemoryLinks>,
  extractorVersion: string,
  now: number,
): Promise<boolean> {
  const guard = candidateGuard();
  const bindings = guardBindings(candidate, extractorVersion, now);
  const statements = [
    db.prepare(`DELETE FROM memory_links WHERE source_memory_id = ? AND ${guard}`).bind(candidate.memoryId, ...bindings),
    ...await memoryLinkInsertStatements(db, {
      sourceMemoryId: candidate.memoryId,
      sourceRevision: candidate.revision,
      projectId: candidate.projectId,
      namespace: candidate.namespace,
      links: extraction.links,
      guard: { sql: guard, bindings },
    }),
    db.prepare(
      `UPDATE memory_link_index
       SET status = 'complete', truncated = ?, attempts = 0, next_attempt_at = ?
       WHERE memory_id = ? AND revision = ? AND extractor_version = ? AND ${guard}`,
    ).bind(
      extraction.truncated ? 1 : 0,
      now,
      candidate.memoryId,
      candidate.revision,
      extractorVersion,
      ...bindings,
    ),
  ];
  const results = await db.batch(statements);
  return (results.at(-1)?.meta.changes ?? 0) === 1;
}

async function failCandidate(db: D1Database, candidate: GraphCandidate, extractorVersion: string, now: number): Promise<boolean> {
  const state = await db.prepare("SELECT attempts FROM memory_link_index WHERE memory_id = ? AND revision = ? AND extractor_version = ?")
    .bind(candidate.memoryId, candidate.revision, extractorVersion).first<{ attempts: number }>();
  const attempts = (state?.attempts ?? 0) + 1;
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 12));
  const result = await db.prepare(
    `UPDATE memory_link_index SET status = 'failed', attempts = attempts + 1, next_attempt_at = ?
     WHERE memory_id = ? AND revision = ? AND extractor_version = ? AND ${candidateGuard()}`,
  ).bind(
    now + delay,
    candidate.memoryId,
    candidate.revision,
    extractorVersion,
    ...guardBindings(candidate, extractorVersion, now),
  ).run();
  return (result.meta.changes ?? 0) === 1;
}

export async function processPendingGraphIndex(
  db: D1Database,
  objects: ImmutableObjectStore,
  requestedLimit = MAX_GRAPH_INDEX_BATCH,
  now = Date.now(),
  extractorVersion = MEMORY_LINK_EXTRACTOR_VERSION,
): Promise<GraphIndexProcessResult> {
  const limit = Math.min(MAX_GRAPH_INDEX_BATCH, Math.max(1, Math.trunc(requestedLimit)));
  const candidates = await db.prepare(
    `SELECT m.id AS memoryId, m.project_id AS projectId, m.namespace, m.key,
            m.current_revision AS revision, m.current_object_key AS objectKey, m.current_hash AS contentHash,
            i.extractor_version AS stateVersion, i.status AS stateStatus
     FROM memory_link_index i JOIN memories m ON m.id = i.memory_id
     WHERE ((i.status IN ('pending', 'failed') AND i.next_attempt_at <= ?) OR i.extractor_version <> ?)
       AND i.revision = m.current_revision AND m.deleted = 0 AND m.indexable = 1
       AND m.current_object_key IS NOT NULL AND m.current_hash IS NOT NULL
     ORDER BY i.next_attempt_at, i.memory_id LIMIT ?`,
  ).bind(now, extractorVersion, limit).all<GraphCandidate>();

  let succeeded = 0;
  let failed = 0;
  let stale = 0;
  for (const candidate of candidates.results) {
    if (!await markCandidatePending(db, candidate, extractorVersion, now)) {
      stale += 1;
      continue;
    }
    try {
      const markdown = await objects.getOkf(candidate.objectKey, candidate.contentHash);
      if (markdown === null) throw new Error("Canonical object is missing");
      const document = parseOkf(markdown);
      const extraction = extractMemoryLinks(candidate.key, document.body, document.frontmatter.sources);
      if (extraction.status !== "complete") throw new Error("Graph extraction failed");
      if (await completeCandidate(db, candidate, extraction, extractorVersion, now)) succeeded += 1;
      else stale += 1;
    } catch {
      try {
        if (await failCandidate(db, candidate, extractorVersion, now)) failed += 1;
        else stale += 1;
      } catch {
        failed += 1;
      }
    }
  }
  return { selected: candidates.results.length, succeeded, failed, stale };
}

export async function enqueueGraphReindex(db: D1Database, now = Date.now()): Promise<{ graphMarked: number }> {
  const result = await db.prepare(
    `INSERT INTO memory_link_index (memory_id, revision, extractor_version, status, truncated, attempts, next_attempt_at)
     SELECT id, current_revision, ?, 'pending', 0, 0, ? FROM memories
     WHERE deleted = 0 AND indexable = 1 AND current_object_key IS NOT NULL AND current_hash IS NOT NULL
     ON CONFLICT(memory_id) DO UPDATE SET
       revision = excluded.revision, extractor_version = excluded.extractor_version,
       status = 'pending', truncated = 0, attempts = 0, next_attempt_at = excluded.next_attempt_at`,
  ).bind(MEMORY_LINK_EXTRACTOR_VERSION, now).run();
  return { graphMarked: result.meta.changes ?? 0 };
}
