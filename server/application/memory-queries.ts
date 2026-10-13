import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { memories, projects } from "../db/schema";
import type { ActorContext } from "../domain/identity";
import type { MemoryRecord } from "../domain/memory";
import { nonEmptyString, normalizeMemoryTags } from "../domain/memory-normalization";
import { parseOkf } from "../domain/okf";
import { decodeCursor, encodeCursor } from "../shared/cursor-codec";
import type { ImmutableObjectStore } from "../storage/r2-object-store";
import { MemoryServiceError, type MemoryHistoryResult, type MemoryRevisionMetadata } from "./memory-service";

export type CurrentMemory = typeof memories.$inferSelect;

export interface HistoricalRevision {
  id: string;
  memoryId: string;
  revision: number;
  action: "upsert" | "delete";
  objectKey: string | null;
  contentHash: string;
  createdAt: number;
}

const MAX_HISTORY_CURSOR_LENGTH = 512;

function historyCursor(revision: number): string {
  return encodeCursor({ revision });
}

function parseHistoryCursor(cursor?: string): number | undefined {
  if (!cursor) return undefined;
  const value = decodeCursor(cursor, MAX_HISTORY_CURSOR_LENGTH);
  if (!value || !Number.isInteger(value.revision) || Number(value.revision) < 1) {
    throw new MemoryServiceError("INVALID_INPUT", "Invalid history cursor");
  }
  return Number(value.revision);
}

export class MemoryQueries {
  private readonly orm;

  constructor(
    private readonly db: D1Database,
    private readonly objects: ImmutableObjectStore,
    private readonly actor: ActorContext,
  ) {
    this.orm = drizzle(db, { schema: { projects, memories } });
  }

  async findCurrent(project: string, namespace: string, key: string): Promise<CurrentMemory | null> {
    const rows = await this.orm
      .select({ memories })
      .from(memories)
      .innerJoin(projects, eq(memories.projectId, projects.id))
      .where(and(eq(projects.ownerId, this.actor.ownerId), eq(projects.slug, project), eq(memories.namespace, namespace), eq(memories.key, key)))
      .limit(1);
    return rows[0]?.memories ?? null;
  }

  async history(project: string, namespace: string, key: string, limit: number, cursor?: string): Promise<MemoryHistoryResult> {
    const before = parseHistoryCursor(cursor);
    const rows = await this.db.prepare(
      `SELECT r.revision, r.action, r.content_hash AS contentHash, r.created_at AS createdAt
       FROM memory_revisions r JOIN memories m ON m.id = r.memory_id JOIN projects p ON p.id = m.project_id
       WHERE p.owner_id = ? AND p.slug = ? AND m.namespace = ? AND m.key = ? AND (? IS NULL OR r.revision < ?)
       ORDER BY r.revision DESC LIMIT ?`,
    ).bind(this.actor.ownerId, project, namespace, key, before ?? null, before ?? null, limit + 1)
      .all<{ revision: number; action: "upsert" | "delete"; contentHash: string; createdAt: number }>();
    const hasMore = rows.results.length > limit;
    const page = rows.results.slice(0, limit);
    const items: MemoryRevisionMetadata[] = page.map((row) => ({
      revision: Number(row.revision), action: row.action, contentHash: row.contentHash,
      createdAt: new Date(Number(row.createdAt)).toISOString(),
    }));
    return { items, ...(hasMore ? { nextCursor: historyCursor(items.at(-1)!.revision) } : {}) };
  }

  async findRevision(project: string, namespace: string, key: string, revision: number): Promise<HistoricalRevision | null> {
    const row = await this.db.prepare(
      `SELECT r.id, r.memory_id AS memoryId, r.revision, r.action, r.object_key AS objectKey,
              r.content_hash AS contentHash, r.created_at AS createdAt
       FROM memory_revisions r JOIN memories m ON m.id = r.memory_id JOIN projects p ON p.id = m.project_id
       WHERE p.owner_id = ? AND p.slug = ? AND m.namespace = ? AND m.key = ? AND r.revision = ?`,
    ).bind(this.actor.ownerId, project, namespace, key, revision).first<HistoricalRevision>();
    return row ?? null;
  }

  async hydrate(
    project: string,
    namespace: string,
    key: string,
    revision: number,
    objectKey: string,
    hash: string,
    times?: { createdAt?: number; updatedAt?: number },
  ): Promise<MemoryRecord> {
    let markdown: string | null;
    try {
      markdown = await this.objects.getOkf(objectKey, hash);
    } catch {
      throw new MemoryServiceError("INTERNAL_ERROR", "Memory object failed integrity verification");
    }
    if (markdown === null) throw new MemoryServiceError("INTERNAL_ERROR", "Current memory object is missing");
    const document = parseOkf(markdown);
    const attachmentRows = await this.db
      .prepare(
        `SELECT mra.attachment_id AS attachmentId
         FROM memory_revision_attachments mra
         JOIN memory_revisions r ON r.id = mra.memory_revision_id
         JOIN memories m ON m.id = r.memory_id
         JOIN projects p ON p.id = m.project_id
         WHERE p.owner_id = ? AND p.slug = ? AND m.namespace = ? AND m.key = ? AND r.revision = ?
         ORDER BY mra.attachment_id`,
      )
      .bind(this.actor.ownerId, project, namespace, key, revision)
      .all<{ attachmentId: string }>();
    return {
      project,
      namespace,
      key,
      revision,
      kind: nonEmptyString(document.frontmatter.kind),
      tags: normalizeMemoryTags(document.frontmatter.tags),
      status: document.normalized.status,
      okfMarkdown: markdown,
      content: document.body,
      attachmentIds: attachmentRows.results.map((row) => row.attachmentId),
      createdAt: times?.createdAt === undefined ? undefined : new Date(times.createdAt).toISOString(),
      updatedAt: times?.updatedAt === undefined ? undefined : new Date(times.updatedAt).toISOString(),
    };
  }
}
