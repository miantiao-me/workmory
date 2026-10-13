import {
  claimOutboxCandidate,
  enqueueCurrentMemoriesForReindex,
  markOutboxFailed,
  queryPendingOutbox,
} from "./outbox-store";
import { applySemanticDelete, applySemanticUpsert } from "./semantic-mutations";
import type { SemanticRuntime } from "./types";
import { processVectorCleanup, type VectorCleanupResult } from "./vector-cleanup";

export interface OutboxProcessResult {
  claimed: number;
  succeeded: number;
  failed: number;
}

export async function processPendingOutbox(
  db: D1Database,
  runtime: SemanticRuntime,
  requestedLimit = 5,
): Promise<OutboxProcessResult> {
  const limit = Math.min(10, Math.max(1, Math.trunc(requestedLimit)));
  const candidates = await queryPendingOutbox(db, limit);
  let claimed = 0;
  let succeeded = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const claim = await claimOutboxCandidate(db, candidate);
    if (!claim) continue;
    claimed += 1;
    try {
      const completed = claim.action === "upsert"
        ? await applySemanticUpsert(db, runtime, claim)
        : await applySemanticDelete(db, claim);
      if (completed) succeeded += 1;
    } catch (error) {
      if (await markOutboxFailed(db, claim, error)) failed += 1;
    }
  }
  return { claimed, succeeded, failed };
}

export async function enqueueSemanticReindex(db: D1Database): Promise<{ enqueued: number }> {
  return enqueueCurrentMemoriesForReindex(db);
}

export async function processSemanticMaintenance(
  db: D1Database,
  runtime: SemanticRuntime,
  requestedLimit = 10,
): Promise<{ outbox: OutboxProcessResult; cleanup: VectorCleanupResult }> {
  const outbox = await processPendingOutbox(db, runtime, requestedLimit);
  const cleanup = await processVectorCleanup(db, runtime.vectors, requestedLimit);
  return { outbox, cleanup };
}
