import { AttachmentCleanup } from "../attachments/attachment-cleanup";
import type { RuntimeBindings } from "../env";
import { createCloudflareSemanticRuntime } from "../search/cloudflare-adapters";
import { enqueueSemanticReindex, processSemanticMaintenance, type OutboxProcessResult } from "../search/outbox-processor";
import type { VectorCleanupResult } from "../search/vector-cleanup";
import { R2AttachmentObjectStore } from "../storage/attachment-object-store";
import { CanonicalObjectCleanup, type CanonicalCleanupResult } from "../storage/canonical-object-cleanup";
import { R2ObjectStore } from "../storage/r2-object-store";
import { enqueueGraphReindex, processPendingGraphIndex, type GraphIndexProcessResult } from "../application/graph-index-processor";
import { getMaintenanceStatus, type MaintenanceStatus } from "./status";

export type MaintenanceAction = "process" | "reindex" | "status";

export interface MaintenanceProcessResult {
  outbox: OutboxProcessResult;
  vectorCleanup: VectorCleanupResult;
  canonicalCleanup: CanonicalCleanupResult;
  attachments: { markedFailed: number; deleted: number };
  graph: GraphIndexProcessResult;
}

export interface MaintenanceReindexResult {
  reindex: { enqueued: number; graphMarked: number };
}

export type MaintenanceResult = MaintenanceProcessResult | MaintenanceReindexResult | MaintenanceStatus;

export type MaintenanceService = (action?: MaintenanceAction) => Promise<MaintenanceResult>;

/** Standalone maintenance entry point used by both HTTP handlers and scheduled tasks. */
export function createMaintenanceService(env: RuntimeBindings): MaintenanceService {
  return async (action = "process") => {
    if (action === "status") return getMaintenanceStatus(env.DB);
    if (action === "reindex") {
      const [semanticReindex, graphReindex] = await Promise.all([enqueueSemanticReindex(env.DB), enqueueGraphReindex(env.DB)]);
      return { reindex: { ...semanticReindex, ...graphReindex } };
    }
    const semantic = createCloudflareSemanticRuntime(env);
    const attachmentCleanup = new AttachmentCleanup(env.DB, new R2AttachmentObjectStore(env.BUCKET));
    const canonicalCleanup = new CanonicalObjectCleanup(env.DB, env.BUCKET);
    const memoryObjects = new R2ObjectStore(env.BUCKET);
    const [semanticResult, cleanupResult, canonicalResult, graph] = await Promise.all([
      processSemanticMaintenance(env.DB, semantic, 10),
      attachmentCleanup.cleanupStale(),
      canonicalCleanup.process(10),
      processPendingGraphIndex(env.DB, memoryObjects, 10),
    ]);
    return { outbox: semanticResult.outbox, vectorCleanup: semanticResult.cleanup, canonicalCleanup: canonicalResult, attachments: cleanupResult, graph };
  };
}
