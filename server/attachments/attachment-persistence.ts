// Shared D1 persistence statements for attachment lifecycle transitions.

/** Marks a claimed `deleting` attachment as `deleted`; returns rows changed (0 or 1). */
export async function markAttachmentDeleted(db: D1Database, id: string, claimToken: string, now: number): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE attachments SET status = 'deleted', error_code = NULL, deleted_at = ?, updated_at = ?,
         delete_claim_token = NULL, delete_claimed_at = NULL
       WHERE id = ? AND status = 'deleting' AND delete_claim_token = ?`,
    )
    .bind(now, now, id, claimToken)
    .run();
  return result.meta.changes ?? 0;
}
