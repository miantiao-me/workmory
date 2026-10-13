import type { SearchMemoryRequest, SearchResult } from "../domain/memory";
import { vectorScopeId, type ActorContext } from "../domain/identity";
import { queryLexicalCandidates } from "./lexical-candidates";
import { candidateDepth, weightedRrf } from "./rrf";
import { qualifySemanticCandidates } from "./semantic-candidates";
import { assertVectorDimensions, type SemanticRuntime } from "./types";

export async function hybridSearch(
  db: D1Database,
  actor: ActorContext,
  request: SearchMemoryRequest,
  runtime?: SemanticRuntime,
  now: () => number = Date.now,
): Promise<SearchResult> {
  const limit = Math.min(50, Math.max(1, Math.trunc(request.limit)));
  const semanticWeight = Math.min(1, Math.max(0, request.semanticWeight));
  const candidateK = candidateDepth(limit);
  const searchedAt = now();
  const lexicalPromise = queryLexicalCandidates(db, actor, request, candidateK, searchedAt);

  if (semanticWeight === 0) {
    const lexical = await lexicalPromise;
    return {
      items: weightedRrf({ lexical: lexical.ranked, semantic: [], exactIds: lexical.exactIds, semanticWeight: 0, limit }),
      degraded: false,
      effectiveSemanticWeight: 0,
    };
  }
  const coveragePromise = db.prepare(
    `SELECT COUNT(*) AS eligible,
            COALESCE(SUM(CASE WHEN sv.memory_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS projected
     FROM memories m JOIN projects p ON p.id = m.project_id
     LEFT JOIN semantic_vectors sv ON sv.memory_id = m.id AND sv.revision = m.current_revision AND sv.content_hash = m.current_hash
       ${runtime ? "AND sv.model = ? AND sv.dimensions = ? AND sv.index_version = ?" : ""}
     WHERE p.owner_id = ? AND p.slug = ? AND m.namespace = ? AND m.deleted = 0 AND m.indexable = 1
       AND (m.expires_at IS NULL OR m.expires_at > ?)`,
  ).bind(...(runtime ? [runtime.config.model, runtime.config.dimensions, runtime.config.indexVersion] : []), actor.ownerId, request.project, request.namespace, searchedAt)
    .first<{ eligible: number; projected: number }>()
    .then((row) => {
      const eligible = Number(row?.eligible ?? 0);
      const projected = Number(row?.projected ?? 0);
      return { eligible, projected, complete: projected === eligible };
    });
  if (!runtime) {
    const [lexical, coverage] = await Promise.all([lexicalPromise, coveragePromise]);
    return {
      items: weightedRrf({ lexical: lexical.ranked, semantic: [], exactIds: lexical.exactIds, semanticWeight: 0, limit }),
      degraded: true,
      effectiveSemanticWeight: 0,
      degradationReason: "Semantic runtime is not configured; lexical results returned",
      degradationCode: "semantic_runtime_unconfigured",
      semanticProjectionCoverage: coverage,
    };
  }

  const semanticPromise = (async () => {
    const vector = await runtime.embeddings.embedQuery(request.query);
    assertVectorDimensions(vector, runtime.config.dimensions);
    const namespace = await vectorScopeId(actor.ownerId, request.project, request.namespace, runtime.config.indexVersion);
    const matches = await runtime.vectors.query(vector, candidateK, { namespace });
    return qualifySemanticCandidates(db, actor, request, runtime, matches.map((match) => match.id), searchedAt);
  })();
  const [lexicalResult, semanticResult, coverageResult] = await Promise.allSettled([lexicalPromise, semanticPromise, coveragePromise]);
  if (lexicalResult.status === "rejected") throw lexicalResult.reason;
  const coverage = coverageResult.status === "fulfilled" ? coverageResult.value : undefined;
  if (semanticResult.status === "rejected") {
    return {
      items: weightedRrf({ lexical: lexicalResult.value.ranked, semantic: [], exactIds: lexicalResult.value.exactIds, semanticWeight: 0, limit }),
      degraded: true,
      effectiveSemanticWeight: 0,
      degradationReason: "Semantic search unavailable; lexical results returned",
      degradationCode: "semantic_unavailable",
      ...(coverage ? { semanticProjectionCoverage: coverage } : {}),
    };
  }
  return {
    items: weightedRrf({
      lexical: lexicalResult.value.ranked,
      semantic: semanticResult.value,
      exactIds: lexicalResult.value.exactIds,
      semanticWeight,
      limit,
    }),
    degraded: coverage ? !coverage.complete : false,
    effectiveSemanticWeight: semanticWeight,
    ...(coverage ? { semanticProjectionCoverage: coverage } : {}),
    ...((coverage && !coverage.complete) ? {
      degradationCode: "projection_incomplete" as const,
      degradationReason: "Semantic projection is incomplete",
    } : {}),
  };
}
