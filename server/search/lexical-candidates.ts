import type { SearchMemoryRequest } from "../domain/memory";
import type { ActorContext } from "../domain/identity";
import { buildSearchFilters, toCandidate, type CandidateRow } from "./candidate-support";
import type { RankedCandidate } from "./rrf";

export async function queryLexicalSubstringCandidates(
  db: D1Database,
  actor: ActorContext,
  request: SearchMemoryRequest,
  candidateLimit: number,
  now = Date.now(),
): Promise<RankedCandidate[]> {
  const filters = buildSearchFilters(request);
  const result = await db
    .prepare(
      `SELECT s.memory_id AS memoryId, s.revision, s.key,
              COALESCE((SELECT json_group_array(tag) FROM memory_tags result_tags WHERE result_tags.memory_id = s.memory_id), '[]') AS tags,
              s.kind, s.status, s.snippet, s.updated_at AS updatedAt
       FROM memory_search_docs s
       JOIN memories m ON m.id = s.memory_id AND m.current_revision = s.revision
       JOIN projects p ON p.id = m.project_id
       WHERE p.owner_id = ? AND p.slug = ? AND s.namespace = ? AND m.deleted = 0 AND m.indexable = 1
         AND (m.expires_at IS NULL OR m.expires_at > ?)
         AND instr(lower(s.content), lower(?)) > 0
       ${filters.sql}
       ORDER BY s.updated_at DESC LIMIT ?`,
    )
    .bind(actor.ownerId, request.project, request.namespace, now, request.query, ...filters.values, candidateLimit)
    .all<CandidateRow>();
  return result.results.map((candidate) => toCandidate(candidate, request));
}

export async function queryLexicalCandidates(
  db: D1Database,
  actor: ActorContext,
  request: SearchMemoryRequest,
  candidateLimit: number,
  now = Date.now(),
): Promise<{ ranked: RankedCandidate[]; exactIds: Set<string> }> {
  const filters = buildSearchFilters(request);
  const memoryScope = `
    FROM memory_search_docs s
    JOIN memories m ON m.id = s.memory_id AND m.current_revision = s.revision
    JOIN projects p ON p.id = m.project_id
    WHERE p.owner_id = ? AND p.slug = ? AND s.namespace = ? AND m.deleted = 0 AND m.indexable = 1
      AND (m.expires_at IS NULL OR m.expires_at > ?)`;
  const fields = "s.memory_id AS memoryId, s.revision, s.key, COALESCE((SELECT json_group_array(tag) FROM memory_tags result_tags WHERE result_tags.memory_id = s.memory_id), '[]') AS tags, s.kind, s.status, s.snippet, s.updated_at AS updatedAt";
  const exactMatches = await db
    .prepare(
      `SELECT ${fields} ${memoryScope}
       AND (s.key = ? OR EXISTS (SELECT 1 FROM memory_tags exact_tags WHERE exact_tags.memory_id = m.id AND exact_tags.tag = ?))
       ${filters.sql}
       ORDER BY CASE WHEN s.key = ? THEN 0 ELSE 1 END, s.updated_at DESC LIMIT ?`,
    )
    .bind(actor.ownerId, request.project, request.namespace, now, request.query, request.query, ...filters.values, request.query, candidateLimit)
    .all<CandidateRow>();

  let textMatches: RankedCandidate[];
  if ([...request.query].length < 3) {
    textMatches = await queryLexicalSubstringCandidates(db, actor, request, candidateLimit, now);
  } else {
    const safeFtsQuery = `"${request.query.replaceAll('"', '""')}"`;
    const result = await db
      .prepare(
        `SELECT s.memory_id AS memoryId, s.revision, s.key,
                COALESCE((SELECT json_group_array(tag) FROM memory_tags result_tags WHERE result_tags.memory_id = s.memory_id), '[]') AS tags,
                s.kind, s.status,
                CASE WHEN instr(lower(s.content), lower(?)) > 0
                  THEN snippet(memory_search_fts, 5, '', '', ' … ', 64)
                  ELSE s.snippet
                END AS snippet,
                s.updated_at AS updatedAt
         FROM memory_search_docs s
         JOIN memory_search_fts ON memory_search_fts.memory_id = s.memory_id
         JOIN memories m ON m.id = s.memory_id AND m.current_revision = s.revision
         JOIN projects p ON p.id = m.project_id
         WHERE p.owner_id = ? AND p.slug = ? AND s.namespace = ? AND m.deleted = 0 AND m.indexable = 1
           AND (m.expires_at IS NULL OR m.expires_at > ?)
           AND memory_search_fts MATCH ?
         ${filters.sql}
         ORDER BY bm25(memory_search_fts), s.updated_at DESC LIMIT ?`,
      )
      .bind(request.query, actor.ownerId, request.project, request.namespace, now, safeFtsQuery, ...filters.values, candidateLimit)
      .all<CandidateRow>();
    textMatches = result.results.map((candidate) => toCandidate(candidate, request));
  }

  const seen = new Set<string>();
  const ranked: RankedCandidate[] = [];
  for (const candidate of [...exactMatches.results.map((row) => toCandidate(row, request)), ...textMatches]) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    ranked.push(candidate);
    if (ranked.length >= candidateLimit) break;
  }
  const exactIds = new Set(
    exactMatches.results.filter((candidate) => String(candidate.key) === request.query).map((candidate) => String(candidate.memoryId)),
  );
  return { ranked, exactIds };
}
