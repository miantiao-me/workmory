import type { MemoryAttachmentSource } from "../attachments/types";
import { memoryOpaqueId, projectOpaqueId, type ActorContext } from "../domain/identity";
import type { MemoryListResult, MemoryRecord, MutationResult, SearchMemoryRequest, SearchResult } from "../domain/memory";
import { MemoryTagValidationError } from "../domain/memory-normalization";
import { hybridSearch } from "../search/hybrid-search";
import { processSemanticMaintenance } from "../search/outbox-processor";
import type { SemanticRuntime } from "../search/types";
import { logCleanupFailure } from "../shared/cleanup-failure";
import { sha256Hex } from "../shared/crypto";
import { stableJson } from "../shared/stable-json";
import { R2ObjectStore, type ImmutableObjectStore } from "../storage/r2-object-store";
import { MemoryPersistence } from "./memory-persistence";
import { listMemories } from "./memory-list";
import { memoryRequestFingerprint, prepareMemory, prepareRestoredMemory, resolveMemoryAttachment, type PreparedMemory } from "./memory-preparation";
import { MemoryQueries } from "./memory-queries";
import type {
  CompletedOperationReplayRequest,
  CompletedOperationReplayResult,
  DeleteMemoryRequest,
  ListMemoryRequest,
  MemoryHistoryRequest,
  MemoryHistoryResult,
  MemoryRevisionResult,
  RestoreMemoryRequest,
  RetrieveMemoryRequest,
  RetrieveMemoryRevisionRequest,
  StoreMemoryRequest,
  UpdateLastMemoryRequest,
} from "./memory-service";
import type { ReplayableMemoryService } from "./memory-service";
import { MemoryServiceError } from "./memory-service";
import { OperationReceipts } from "./operation-receipts";
import { queryMemoryGraph, type MemoryGraphRequest, type MemoryGraphResult } from "./memory-graph";

export { OPERATION_RECEIPT_LEASE_MS } from "./operation-receipts";

interface MemoryServiceBindings {
  DB: D1Database;
  BUCKET: R2Bucket;
}

interface MemoryServiceFactoryOptions {
  objectStore?: ImmutableObjectStore;
  semantic?: SemanticRuntime;
  defer?: (promise: Promise<unknown>) => void;
  attachments?: MemoryAttachmentSource;
  now?: () => number;
}

export class D1MemoryService implements ReplayableMemoryService {
  private readonly queries: MemoryQueries;
  private readonly persistence: MemoryPersistence;
  private readonly receipts: OperationReceipts;

  constructor(
    private readonly db: D1Database,
    private readonly objects: ImmutableObjectStore,
    private readonly actor: ActorContext,
    private readonly semantic?: SemanticRuntime,
    private readonly defer?: (promise: Promise<unknown>) => void,
    private readonly attachments?: MemoryAttachmentSource,
    private readonly now: () => number = Date.now,
  ) {
    this.queries = new MemoryQueries(db, objects, actor);
    this.persistence = new MemoryPersistence(db, actor);
    this.receipts = new OperationReceipts(db, actor.ownerId, now);
  }

  private complete<T>(value: T, processSemantic = true): T {
    if (processSemantic && this.semantic && this.defer) {
      this.defer(processSemanticMaintenance(this.db, this.semantic, 3).catch(() => undefined));
    }
    return value;
  }

  private async memoryIds(project: string, namespace: string, key: string) {
    const projectId = await projectOpaqueId(this.actor.ownerId, project);
    return { projectId, memoryId: await memoryOpaqueId(projectId, namespace, key) };
  }

  private async releaseAfterFailure(operationId: string | undefined, claimToken: string | null): Promise<void> {
    try {
      await this.receipts.release(operationId, claimToken);
    } catch (releaseError) {
      logCleanupFailure("operation receipt release", releaseError);
    }
  }

  private async commitPreparedRevision(input: {
    project: string;
    namespace: string;
    key: string;
    projectId: string;
    memoryId: string;
    revision: number;
    currentRevision: number;
    preparedMemory: PreparedMemory;
    operationId?: string;
    operationHash: string;
    claimToken: string | null;
    indexable: boolean;
    now: number;
    times: { createdAt: number; updatedAt: number };
  }): Promise<MemoryRecord> {
    const { objectKey, writeToken } = await this.writeCanonical(input.projectId, input.memoryId, input.revision, input.preparedMemory, input.now);
    const statements = await this.persistence.storeStatements({
      projectId: input.projectId,
      memoryId: input.memoryId,
      project: input.project,
      namespace: input.namespace,
      key: input.key,
      revision: input.revision,
      currentRevision: input.currentRevision,
      objectKey,
      writeToken,
      preparedMemory: input.preparedMemory,
      operationId: input.operationId,
      operationHash: input.operationHash,
      indexable: input.indexable,
      now: input.now,
    });
    const completion = this.receipts.completionStatement(input.operationId, input.claimToken, input.revision, objectKey, input.preparedMemory.hash, input.now);
    if (completion) statements.unshift(completion);
    await this.persistence.batch(statements);
    return this.queries.hydrate(input.project, input.namespace, input.key, input.revision, objectKey, input.preparedMemory.hash, input.times);
  }

  private async writeCanonical(
    projectId: string,
    memoryId: string,
    revision: number,
    preparedMemory: PreparedMemory,
    now: number,
  ): Promise<{ objectKey: string; writeToken: string }> {
    const objectKey = `okf/${projectId}/${memoryId}/${revision}/${crypto.randomUUID().replaceAll("-", "")}.md`;
    const writeToken = crypto.randomUUID();
    await this.db.prepare(
      `INSERT INTO canonical_object_staging
       (object_key, memory_id, revision, write_token, status, attempts, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
    ).bind(objectKey, memoryId, revision, writeToken, now, now).run();
    await this.objects.putOkf(objectKey, preparedMemory.markdown, preparedMemory.hash);
    const adopted = await this.db.prepare(
      `UPDATE canonical_object_staging SET status = 'processing', claim_token = ?, claimed_at = ?
       WHERE object_key = ? AND write_token = ? AND status = 'pending' AND delete_confirmations = 0`,
    ).bind(writeToken, this.now(), objectKey, writeToken).run();
    if ((adopted.meta.changes ?? 0) !== 1) {
      throw new MemoryServiceError("REVISION_CONFLICT", "Canonical object staging claim was lost");
    }
    return { objectKey, writeToken };
  }

  async replayCompletedOperation(request: CompletedOperationReplayRequest): Promise<CompletedOperationReplayResult> {
    if (!request.operationId) return null;
    const { memoryId } = await this.memoryIds(request.project, request.namespace, request.key);
    const priorRevision = await this.receipts.findRevision(request.operationId);
    if (!priorRevision) return null;
    if (priorRevision.operationHash !== request.operationFingerprint || priorRevision.memoryId !== memoryId || priorRevision.action !== request.action) {
      throw new MemoryServiceError("OPERATION_CONFLICT", "operation_id was used for a different operation");
    }
    if (request.action === "delete") {
      return { action: "delete", result: { key: request.key, revision: priorRevision.revision, deleted: true, operationId: request.operationId } };
    }
    if (!priorRevision.objectKey) throw new MemoryServiceError("INTERNAL_ERROR", "Completed operation revision is incomplete");
    return {
      action: "upsert",
      record: await this.queries.hydrate(
        request.project,
        request.namespace,
        request.key,
        priorRevision.revision,
        priorRevision.objectKey,
        priorRevision.contentHash,
      ),
    };
  }

  async store(request: StoreMemoryRequest): Promise<MemoryRecord> {
    const indexable = request.indexable ?? true;
    const { projectId, memoryId } = await this.memoryIds(request.project, request.namespace, request.key);
    const operationHash = request.operationFingerprint ?? await memoryRequestFingerprint(request);
    const replay = await this.replayCompletedOperation({ ...request, action: "upsert", operationFingerprint: operationHash });
    if (replay?.action === "upsert") return this.complete(replay.record, indexable);

    const { claimToken, receipt } = await this.receipts.acquire({
      operationId: request.operationId,
      requestHash: operationHash,
      action: "upsert",
      memoryId,
      project: request.project,
      namespace: request.namespace,
      key: request.key,
    });
    if (receipt?.status === "complete") {
      if (receipt.revision === null || !receipt.objectKey || !receipt.contentHash) {
        throw new MemoryServiceError("INTERNAL_ERROR", "Completed operation receipt is incomplete");
      }
      return this.complete(await this.queries.hydrate(receipt.project, receipt.namespace, receipt.memoryKey, Number(receipt.revision), receipt.objectKey, receipt.contentHash), indexable);
    }

    try {
      const currentMemory = await this.queries.findCurrent(request.project, request.namespace, request.key);
      if (currentMemory && currentMemory.indexable !== indexable) {
        throw new MemoryServiceError("INVALID_INPUT", "Memory indexability cannot be changed");
      }
      const currentRevision = currentMemory?.currentRevision ?? 0;
      if (request.expectedRevision !== undefined && request.expectedRevision !== currentRevision) {
        throw new MemoryServiceError("REVISION_CONFLICT", "expected_revision does not match current revision");
      }
      const attachment = await resolveMemoryAttachment(request, this.attachments);
      let preparedMemory: PreparedMemory;
      try {
        preparedMemory = await prepareMemory(request, attachment);
      } catch (error) {
        if (error instanceof MemoryTagValidationError) throw new MemoryServiceError("INVALID_INPUT", error.message);
        throw error;
      }
      if (currentMemory && !currentMemory.deleted && currentMemory.currentHash === preparedMemory.hash && currentMemory.currentObjectKey) {
        await this.receipts.complete(request.operationId, claimToken, currentMemory.currentRevision, currentMemory.currentObjectKey, currentMemory.currentHash);
        return this.complete(await this.queries.hydrate(request.project, request.namespace, request.key, currentMemory.currentRevision, currentMemory.currentObjectKey, currentMemory.currentHash, currentMemory), indexable);
      }

      const revision = currentRevision + 1;
      const now = this.now();
      const record = await this.commitPreparedRevision({
        project: request.project,
        namespace: request.namespace,
        key: request.key,
        projectId,
        memoryId,
        revision,
        currentRevision,
        preparedMemory,
        operationId: request.operationId,
        operationHash,
        claimToken,
        indexable,
        now,
        times: { createdAt: currentMemory?.createdAt ?? now, updatedAt: now },
      });
      return this.complete(record, indexable);
    } catch (error) {
      await this.releaseAfterFailure(request.operationId, claimToken);
      throw error;
    }
  }

  async retrieve(request: RetrieveMemoryRequest): Promise<MemoryRecord | null> {
    const currentMemory = await this.queries.findCurrent(request.project, request.namespace, request.key);
    if (!currentMemory || currentMemory.deleted || (currentMemory.expiresAt !== null && currentMemory.expiresAt <= this.now()) || !currentMemory.currentObjectKey || !currentMemory.currentHash) {
      return null;
    }
    return this.queries.hydrate(request.project, request.namespace, request.key, currentMemory.currentRevision, currentMemory.currentObjectKey, currentMemory.currentHash, currentMemory);
  }

  history(request: MemoryHistoryRequest): Promise<MemoryHistoryResult> {
    return this.queries.history(request.project, request.namespace, request.key, request.limit, request.cursor);
  }

  async retrieveRevision(request: RetrieveMemoryRevisionRequest): Promise<MemoryRevisionResult> {
    const revision = await this.queries.findRevision(request.project, request.namespace, request.key, request.revision);
    if (!revision) throw new MemoryServiceError("REVISION_NOT_FOUND", "Memory revision was not found");
    const metadata = {
      revision: Number(revision.revision), action: revision.action, contentHash: revision.contentHash,
      createdAt: new Date(Number(revision.createdAt)).toISOString(),
    };
    if (revision.action === "delete") return { revision: metadata, record: null };
    if (!revision.objectKey) throw new MemoryServiceError("INTERNAL_ERROR", "Memory revision object reference is missing");
    return {
      revision: metadata,
      record: await this.queries.hydrate(
        request.project, request.namespace, request.key, revision.revision, revision.objectKey, revision.contentHash,
        { createdAt: revision.createdAt, updatedAt: revision.createdAt },
      ),
    };
  }

  async restore(request: RestoreMemoryRequest): Promise<MemoryRecord> {
    const { projectId, memoryId } = await this.memoryIds(request.project, request.namespace, request.key);
    const operationHash = await sha256Hex(stableJson({
      operation: "memory_restore",
      project: request.project,
      namespace: request.namespace,
      key: request.key,
      sourceRevision: request.sourceRevision,
      expectedRevision: request.expectedRevision ?? null,
    }));
    const replay = await this.replayCompletedOperation({ ...request, action: "upsert", operationFingerprint: operationHash });
    if (replay?.action === "upsert") return this.complete(replay.record);
    const { claimToken, receipt } = await this.receipts.acquire({
      operationId: request.operationId, requestHash: operationHash, action: "upsert", memoryId,
      project: request.project, namespace: request.namespace, key: request.key,
    });
    if (receipt?.status === "complete") {
      if (receipt.revision === null || !receipt.objectKey || !receipt.contentHash) {
        throw new MemoryServiceError("INTERNAL_ERROR", "Completed restore receipt is incomplete");
      }
      return this.complete(await this.queries.hydrate(
        receipt.project, receipt.namespace, receipt.memoryKey, Number(receipt.revision), receipt.objectKey, receipt.contentHash,
      ));
    }
    try {
      const source = await this.queries.findRevision(request.project, request.namespace, request.key, request.sourceRevision);
      if (!source) throw new MemoryServiceError("REVISION_NOT_FOUND", "Memory revision was not found");
      if (source.action !== "upsert" || !source.objectKey) {
        throw new MemoryServiceError("REVISION_NOT_RESTORABLE", "Delete revisions cannot be restored");
      }
      const current = await this.queries.findCurrent(request.project, request.namespace, request.key);
      if (!current) throw new MemoryServiceError("REVISION_NOT_FOUND", "Memory revision was not found");
      if (request.expectedRevision !== undefined && request.expectedRevision !== current.currentRevision) {
        throw new MemoryServiceError("REVISION_CONFLICT", "expected_revision does not match current revision");
      }
      const sourceRecord = await this.queries.hydrate(
        request.project, request.namespace, request.key, source.revision, source.objectKey, source.contentHash,
      );
      if (!sourceRecord.okfMarkdown) throw new MemoryServiceError("INTERNAL_ERROR", "Historical canonical record is incomplete");
      let preparedMemory: PreparedMemory;
      try {
        preparedMemory = await prepareRestoredMemory(request, sourceRecord.okfMarkdown, sourceRecord.attachmentIds ?? []);
      } catch (error) {
        if (error instanceof MemoryTagValidationError) throw new MemoryServiceError("INVALID_INPUT", error.message);
        throw error;
      }
      const revision = current.currentRevision + 1;
      const now = this.now();
      const record = await this.commitPreparedRevision({
        project: request.project,
        namespace: request.namespace,
        key: request.key,
        projectId,
        memoryId,
        revision,
        currentRevision: current.currentRevision,
        preparedMemory,
        operationId: request.operationId,
        operationHash,
        claimToken,
        indexable: current.indexable,
        now,
        times: { createdAt: current.createdAt, updatedAt: now },
      });
      return this.complete(record, current.indexable);
    } catch (error) {
      await this.releaseAfterFailure(request.operationId, claimToken);
      throw error;
    }
  }

  list(request: ListMemoryRequest): Promise<MemoryListResult> {
    return listMemories(this.db, this.actor, request, this.now());
  }

  async delete(request: DeleteMemoryRequest): Promise<MutationResult> {
    const { memoryId } = await this.memoryIds(request.project, request.namespace, request.key);
    const operationHash = request.operationFingerprint ?? await memoryRequestFingerprint(request);
    const replay = await this.replayCompletedOperation({ ...request, action: "delete", operationFingerprint: operationHash });
    if (replay?.action === "delete") return this.complete(replay.result);

    const { claimToken, receipt } = await this.receipts.acquire({
      operationId: request.operationId,
      requestHash: operationHash,
      action: "delete",
      memoryId,
      project: request.project,
      namespace: request.namespace,
      key: request.key,
    });
    if (receipt?.status === "complete") {
      if (receipt.revision === null) throw new MemoryServiceError("INTERNAL_ERROR", "Completed operation receipt is incomplete");
      return this.complete({ key: request.key, revision: Number(receipt.revision), deleted: true, operationId: request.operationId });
    }

    try {
      const currentMemory = await this.queries.findCurrent(request.project, request.namespace, request.key);
      if (!currentMemory || currentMemory.deleted) throw new MemoryServiceError("NOT_FOUND", "Memory was not found");
      if (request.expectedRevision !== undefined && request.expectedRevision !== currentMemory.currentRevision) {
        throw new MemoryServiceError("REVISION_CONFLICT", "expected_revision does not match current revision");
      }
      const revision = currentMemory.currentRevision + 1;
      const now = this.now();
      const tombstoneHash = await sha256Hex(`delete\u0000${memoryId}\u0000${revision}`);
      const statements = await this.persistence.deleteStatements({ memoryId, revision, currentRevision: currentMemory.currentRevision, tombstoneHash, operationId: request.operationId, operationHash, indexable: currentMemory.indexable, now });
      const completion = this.receipts.completionStatement(request.operationId, claimToken, revision, null, tombstoneHash, now);
      if (completion) statements.unshift(completion);
      await this.persistence.batch(statements);
      return this.complete({ key: request.key, revision, deleted: true, operationId: request.operationId }, currentMemory.indexable);
    } catch (error) {
      await this.releaseAfterFailure(request.operationId, claimToken);
      throw error;
    }
  }

  search(request: SearchMemoryRequest): Promise<SearchResult> {
    return hybridSearch(this.db, this.actor, request, this.semantic, this.now);
  }

  graph(request: MemoryGraphRequest): Promise<MemoryGraphResult> {
    return queryMemoryGraph(this.db, this.actor, request, this.now());
  }

  getLast(request: { project: string; namespace: string }): Promise<MemoryRecord | null> {
    return this.retrieve({ ...request, key: "system/last_memory" });
  }

  updateLast(request: UpdateLastMemoryRequest): Promise<MemoryRecord> {
    return this.store({
      project: request.project, namespace: request.namespace, key: "system/last_memory", source: { content: request.content },
      frontmatter: { type: "Checkpoint", title: "Last Project Checkpoint", ...(request.summary ? { description: request.summary } : {}) },
      kind: "Checkpoint", tags: ["last_memory", "checkpoint"], expectedRevision: request.expectedRevision, operationId: request.operationId,
    });
  }
}

export function createMemoryService(bindings: MemoryServiceBindings, actor: ActorContext, options: MemoryServiceFactoryOptions = {}): ReplayableMemoryService {
  if (!actor.ownerId || !actor.actorId) throw new MemoryServiceError("INVALID_INPUT", "Actor context requires ownerId and actorId");
  if (actor.authKind === "root" && actor.ownerId !== "root") throw new MemoryServiceError("INVALID_INPUT", "root auth must use the root owner");
  if (actor.authKind === "access" && actor.ownerId === "root") throw new MemoryServiceError("INVALID_INPUT", "root owner is reserved for root authentication");
  return new D1MemoryService(bindings.DB, options.objectStore ?? new R2ObjectStore(bindings.BUCKET), actor, options.semantic, options.defer, options.attachments, options.now);
}
