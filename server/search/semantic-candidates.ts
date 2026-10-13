import type { ActorContext } from "../domain/identity";
import type { SearchMemoryRequest } from "../domain/memory";
import { buildSearchFilters, toCandidate, type CandidateRow } from "./candidate-support";
import type { RankedCandidate } from "./rrf";
import type { SemanticRuntime } from "./types";

export async function qualifySemanticCandidates(
  db: D1Database,
  actor: ActorContext,
  request: SearchMemoryRequest,
  runtime: SemanticRuntime,
  vectorIds: string[],
  now = Date.now(),
): Promise<RankedCandidate[]> {
  const ids = [...new Set(vectorIds)].slice(0, 100);
  if (ids.length === 0) return [];
  const filters = buildSearchFilters(request);
  const candidates: Array<CandidateRow & { vectorId: string }> = [];
  for (let offset = 0; offset < ids.length; offset += 50) {
    const batch = ids.slice(offset, offset + 50);
    const result = await db
      .prepare(
        `SELECT s.memory_id AS memoryId, s.revision, s.key,
                COALESCE((SELECT json_group_array(tag) FROM memory_tags result_tags WHERE result_tags.memory_id = s.memory_id), '[]') AS tags,
                s.kind, s.status, s.snippet, s.updated_at AS updatedAt,
                sv.vector_id AS vectorId
         FROM semantic_vectors sv
         JOIN memories m ON m.id = sv.memory_id AND m.current_revision = sv.revision AND m.current_hash = sv.content_hash
         JOIN memory_search_docs s ON s.memory_id = m.id AND s.revision = m.current_revision
         JOIN projects p ON p.id = m.project_id
         WHERE sv.vector_id IN (${batch.map(() => "?").join(",")})
           AND sv.model = ? AND sv.dimensions = ? AND sv.index_version = ?
           AND p.owner_id = ? AND p.slug = ? AND s.namespace = ? AND m.deleted = 0 AND m.indexable = 1
           AND (m.expires_at IS NULL OR m.expires_at > ?)
           ${filters.sql}`,
      )
      .bind(...batch, runtime.config.model, runtime.config.dimensions, runtime.config.indexVersion, actor.ownerId, request.project, request.namespace, now, ...filters.values)
      .all<CandidateRow & { vectorId: string }>();
    candidates.push(...result.results);
  }
  const candidatesByVector = new Map(candidates.map((candidate) => [String(candidate.vectorId), candidate]));
  return ids.flatMap((id) => {
    const candidate = candidatesByVector.get(id);
    return candidate ? [toCandidate(candidate, request)] : [];
  });
}
