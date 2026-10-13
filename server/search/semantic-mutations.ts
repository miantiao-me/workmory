import { vectorScopeId } from "../domain/identity";
import {
  commitSemanticDelete,
  commitSemanticUpsert,
  markOutboxDone,
  queueRejectedVector,
  stageVector,
  type OutboxClaim,
} from "./outbox-store";
import { assertVectorDimensions, type SemanticRuntime } from "./types";

interface MemoryIndexState {
  revision: number;
  contentHash: string;
  deleted: number;
  key: string | null;
  tags: string | null;
  content: string | null;
  ownerId: string;
  project: string;
  namespace: string;
}

interface DeleteSnapshot {
  revision: number;
  deleted: number;
  vectorId: string | null;
  vectorRevision: number | null;
}

export async function applySemanticUpsert(
  db: D1Database,
  runtime: SemanticRuntime,
  claim: OutboxClaim,
): Promise<boolean> {
  const memoryState = await db
    .prepare(
      `SELECT m.current_revision AS revision, m.current_hash AS contentHash, m.deleted,
              s.key, s.tags, s.content, p.owner_id AS ownerId, p.slug AS project, m.namespace
       FROM memories m
       JOIN projects p ON p.id = m.project_id
       JOIN index_outbox o ON o.id = ? AND o.status = 'processing' AND o.claim_token = ?
       LEFT JOIN memory_search_docs s ON s.memory_id = m.id AND s.revision = m.current_revision
       WHERE m.id = ? AND m.indexable = 1`,
    )
    .bind(claim.id, claim.claimToken, claim.memoryId)
    .first<MemoryIndexState>();
  if (
    !memoryState ||
    Number(memoryState.deleted) === 1 ||
    Number(memoryState.revision) !== claim.revision ||
    memoryState.contentHash !== claim.contentHash ||
    typeof memoryState.content !== "string"
  ) {
    return markOutboxDone(db, claim, `stale:${claim.id}`);
  }

  const document = `${String(memoryState.key)}\n${String(memoryState.tags ?? "")}\n${memoryState.content}`;
  const values = await runtime.embeddings.embedDocument(document);
  assertVectorDimensions(values, runtime.config.dimensions);
  const vectorId = `vec_${crypto.randomUUID().replaceAll("-", "")}`;
  if (!(await stageVector(db, claim, vectorId))) return false;
  const namespace = await vectorScopeId(memoryState.ownerId, memoryState.project, memoryState.namespace, runtime.config.indexVersion);
  const mutation = await runtime.vectors.upsert({
    id: vectorId,
    values,
    namespace,
    metadata: { revision: claim.revision, indexVersion: runtime.config.indexVersion, scope: namespace },
  });
  const accepted = await commitSemanticUpsert(db, claim, {
    id: vectorId,
    model: runtime.config.model,
    dimensions: runtime.config.dimensions,
    indexVersion: runtime.config.indexVersion,
    mutationId: mutation.mutationId,
  });
  if (!accepted) {
    await queueRejectedVector(db, claim, vectorId);
    return false;
  }
  return true;
}

export async function applySemanticDelete(
  db: D1Database,
  claim: OutboxClaim,
): Promise<boolean> {
  const snapshot = await db
    .prepare(
      `SELECT m.current_revision AS revision, m.deleted, sv.vector_id AS vectorId, sv.revision AS vectorRevision
       FROM memories m
       JOIN index_outbox o ON o.id = ? AND o.status = 'processing' AND o.claim_token = ?
       LEFT JOIN semantic_vectors sv ON sv.memory_id = m.id
       WHERE m.id = ? AND m.indexable = 1`,
    )
    .bind(claim.id, claim.claimToken, claim.memoryId)
    .first<DeleteSnapshot>();
  if (!snapshot || Number(snapshot.revision) !== claim.revision || Number(snapshot.deleted) !== 1) {
    return markOutboxDone(db, claim, `stale:${claim.id}`);
  }

  return commitSemanticDelete(db, claim, snapshot, `queued:${claim.id}`);
}
