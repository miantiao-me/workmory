import { MemoryServiceError } from "./memory-service";

export const OPERATION_RECEIPT_LEASE_MS = 5 * 60_000;

export interface OperationReceipt {
  requestHash: string;
  action: "upsert" | "delete";
  memoryId: string;
  project: string;
  namespace: string;
  memoryKey: string;
  status: "processing" | "complete";
  revision: number | null;
  objectKey: string | null;
  contentHash: string | null;
  claimToken: string | null;
  claimedAt: number | null;
}

export interface RevisionOperation {
  memoryId: string;
  revision: number;
  action: string;
  objectKey: string | null;
  contentHash: string;
  operationHash: string | null;
}

export class OperationReceipts {
  constructor(
    private readonly db: D1Database,
    private readonly ownerId: string,
    private readonly now: () => number,
  ) {}

  async findRevision(operationId?: string): Promise<RevisionOperation | null> {
    if (!operationId) return null;
    return this.db
      .prepare(
        "SELECT memory_id AS memoryId, revision, action, object_key AS objectKey, content_hash AS contentHash, operation_hash AS operationHash FROM memory_revisions WHERE owner_id = ? AND operation_id = ?",
      )
      .bind(this.ownerId, operationId)
      .first<RevisionOperation>();
  }

  async acquire(input: {
    operationId?: string;
    requestHash: string;
    action: "upsert" | "delete";
    memoryId: string;
    project: string;
    namespace: string;
    key: string;
  }): Promise<{ claimToken: string | null; receipt: OperationReceipt | null }> {
    if (!input.operationId) return { claimToken: null, receipt: null };
    const now = this.now();
    const claimToken = crypto.randomUUID();
    const inserted = await this.db
      .prepare(
        `INSERT OR IGNORE INTO operation_receipts
         (owner_id, operation_id, request_hash, action, memory_id, project, namespace, memory_key,
          status, claim_token, claimed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)`,
      )
      .bind(this.ownerId, input.operationId, input.requestHash, input.action, input.memoryId, input.project, input.namespace, input.key, claimToken, now, now)
      .run();
    const receipt = await this.db
      .prepare(
        `SELECT request_hash AS requestHash, action, memory_id AS memoryId, project, namespace,
                memory_key AS memoryKey, status, revision, object_key AS objectKey, content_hash AS contentHash,
                claim_token AS claimToken, claimed_at AS claimedAt
         FROM operation_receipts WHERE owner_id = ? AND operation_id = ?`,
      )
      .bind(this.ownerId, input.operationId)
      .first<OperationReceipt>();
    if (!receipt || receipt.requestHash !== input.requestHash || receipt.action !== input.action || receipt.memoryId !== input.memoryId) {
      throw new MemoryServiceError("OPERATION_CONFLICT", "operation_id was used for a different operation");
    }
    if ((inserted.meta.changes ?? 0) === 1) return { claimToken, receipt };
    if (receipt.status === "complete") return { claimToken: null, receipt };
    if (receipt.claimedAt !== null && Number(receipt.claimedAt) > now - OPERATION_RECEIPT_LEASE_MS) {
      throw new MemoryServiceError("CONFLICT", "operation_id is already in progress");
    }
    const takeover = await this.db
      .prepare(
        `UPDATE operation_receipts SET claim_token = ?, claimed_at = ?
         WHERE owner_id = ? AND operation_id = ? AND status = 'processing'
           AND claim_token IS ? AND claimed_at IS ? AND (claimed_at IS NULL OR claimed_at <= ?)`,
      )
      .bind(claimToken, now, this.ownerId, input.operationId, receipt.claimToken, receipt.claimedAt, now - OPERATION_RECEIPT_LEASE_MS)
      .run();
    if ((takeover.meta.changes ?? 0) !== 1) throw new MemoryServiceError("CONFLICT", "operation_id is already in progress");
    return { claimToken, receipt: { ...receipt, claimToken, claimedAt: now } };
  }

  completionStatement(
    operationId: string | undefined,
    claimToken: string | null,
    revision: number,
    objectKey: string | null,
    contentHash: string,
    now = this.now(),
  ): D1PreparedStatement | null {
    if (!operationId || !claimToken) return null;
    return this.db
      .prepare(
        `UPDATE operation_receipts SET status = 'complete', revision = ?, object_key = ?, content_hash = ?, completed_at = ?
         WHERE owner_id = ? AND operation_id = ? AND status = 'processing' AND claim_token = ?`,
      )
      .bind(revision, objectKey, contentHash, now, this.ownerId, operationId, claimToken);
  }

  async complete(
    operationId: string | undefined,
    claimToken: string | null,
    revision: number,
    objectKey: string | null,
    contentHash: string,
  ): Promise<void> {
    const statement = this.completionStatement(operationId, claimToken, revision, objectKey, contentHash);
    if (!statement) return;
    const result = await statement.run();
    if ((result.meta.changes ?? 0) !== 1) {
      throw new MemoryServiceError("OPERATION_CONFLICT", "operation claim was lost");
    }
  }

  async release(operationId: string | undefined, claimToken: string | null): Promise<void> {
    if (!operationId || !claimToken) return;
    await this.db
      .prepare("DELETE FROM operation_receipts WHERE owner_id = ? AND operation_id = ? AND status = 'processing' AND claim_token = ?")
      .bind(this.ownerId, operationId, claimToken)
      .run();
  }
}
