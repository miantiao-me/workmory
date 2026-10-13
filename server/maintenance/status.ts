import { ATTACHMENT_PROCESSING_TIMEOUT_MS } from "../attachments/policy";
import {
  invalidProcessingClaimSql,
  OUTBOX_CLAIM_LEASE_MS,
  REINDEX_CANDIDATE_PREDICATE,
} from "../search/outbox-store";
import { VECTOR_CLEANUP_LEASE_MS } from "../search/vector-cleanup";
import { CANONICAL_CLEANUP_LEASE_MS, CANONICAL_STAGING_TIMEOUT_MS } from "../storage/canonical-object-cleanup";

export interface MaintenanceStatus {
  outbox: { pending: number; due: number; processing: number; stale: number; retrying: number };
  attachments: { processing: number; staleProcessing: number; failed: number; deleting: number };
  reindex: { candidates: number };
  graph: { pending: number; retrying: number; truncated: number };
  vectorCleanup: { pending: number; due: number; processing: number; stale: number; retrying: number };
  vectorStaging: { total: number; abandoned: number };
  canonicalObjectStaging: { pending: number; due: number; processing: number; stale: number; retrying: number };
}

export async function getMaintenanceStatus(db: D1Database, now = Date.now()): Promise<MaintenanceStatus> {
  const [outbox, attachments, reindex, graph, vectorCleanup, vectorStaging, canonicalObjectStaging] = await Promise.all([
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN status = 'pending' AND next_attempt_at <= ? THEN 1 ELSE 0 END), 0) AS due,
         COALESCE(SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END), 0) AS processing,
         COALESCE(SUM(CASE WHEN ${invalidProcessingClaimSql()} THEN 1 ELSE 0 END), 0) AS stale,
         COALESCE(SUM(CASE WHEN status = 'pending' AND attempts > 0 THEN 1 ELSE 0 END), 0) AS retrying
       FROM index_outbox
       WHERE status IN ('pending', 'processing')`,
    ).bind(now, now - OUTBOX_CLAIM_LEASE_MS).first<MaintenanceStatus["outbox"]>(),
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END), 0) AS processing,
         COALESCE(SUM(CASE WHEN status = 'processing' AND updated_at <= ? THEN 1 ELSE 0 END), 0) AS staleProcessing,
         COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
         COALESCE(SUM(CASE WHEN status = 'deleting' THEN 1 ELSE 0 END), 0) AS deleting
       FROM attachments
       WHERE status IN ('processing', 'failed', 'deleting')`,
    ).bind(now - ATTACHMENT_PROCESSING_TIMEOUT_MS).first<MaintenanceStatus["attachments"]>(),
    db.prepare(`SELECT COUNT(*) AS candidates FROM memories m WHERE ${REINDEX_CANDIDATE_PREDICATE}`)
      .first<{ candidates: number }>(),
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS retrying,
         COALESCE(SUM(CASE WHEN status = 'complete' AND truncated = 1 THEN 1 ELSE 0 END), 0) AS truncated
       FROM memory_link_index`,
    ).first<MaintenanceStatus["graph"]>(),
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN status = 'pending' AND next_attempt_at <= ? THEN 1 ELSE 0 END), 0) AS due,
         COALESCE(SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END), 0) AS processing,
         COALESCE(SUM(CASE WHEN status = 'processing' AND (claim_token IS NULL OR claimed_at IS NULL OR claimed_at <= ?) THEN 1 ELSE 0 END), 0) AS stale,
         COALESCE(SUM(CASE WHEN status = 'pending' AND attempts > 0 THEN 1 ELSE 0 END), 0) AS retrying
       FROM vector_cleanup`,
    ).bind(now, now - VECTOR_CLEANUP_LEASE_MS).first<MaintenanceStatus["vectorCleanup"]>(),
    db.prepare(
      `SELECT COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN o.id IS NULL OR o.status <> 'processing' OR o.claim_token IS NOT s.claim_token THEN 1 ELSE 0 END), 0) AS abandoned
       FROM vector_staging s LEFT JOIN index_outbox o ON o.id = s.outbox_id`,
    ).first<MaintenanceStatus["vectorStaging"]>(),
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN status = 'pending' AND created_at <= ? AND next_attempt_at <= ? THEN 1 ELSE 0 END), 0) AS due,
         COALESCE(SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END), 0) AS processing,
         COALESCE(SUM(CASE WHEN status = 'processing' AND created_at <= ? AND (claim_token IS NULL OR claimed_at IS NULL OR claimed_at <= ?) THEN 1 ELSE 0 END), 0) AS stale,
         COALESCE(SUM(CASE WHEN status = 'pending' AND attempts > 0 THEN 1 ELSE 0 END), 0) AS retrying
       FROM canonical_object_staging`,
    ).bind(
      now - CANONICAL_STAGING_TIMEOUT_MS,
      now,
      now - CANONICAL_STAGING_TIMEOUT_MS,
      now - CANONICAL_CLEANUP_LEASE_MS,
    ).first<MaintenanceStatus["canonicalObjectStaging"]>(),
  ]);

  return {
    outbox: outbox ?? { pending: 0, due: 0, processing: 0, stale: 0, retrying: 0 },
    attachments: attachments ?? { processing: 0, staleProcessing: 0, failed: 0, deleting: 0 },
    reindex: { candidates: reindex?.candidates ?? 0 },
    graph: graph ?? { pending: 0, retrying: 0, truncated: 0 },
    vectorCleanup: vectorCleanup ?? { pending: 0, due: 0, processing: 0, stale: 0, retrying: 0 },
    vectorStaging: vectorStaging ?? { total: 0, abandoned: 0 },
    canonicalObjectStaging: canonicalObjectStaging ?? { pending: 0, due: 0, processing: 0, stale: 0, retrying: 0 },
  };
}
