import type { ActorContext } from "../domain/identity";
import type { MemoryListItem, MemoryListResult } from "../domain/memory";
import { decodeCursor, encodeCursor } from "../shared/cursor-codec";
import { loadMemoryTags, memoryFilterClauses } from "./memory-query-support";
import { MemoryServiceError, type ListMemoryRequest } from "./memory-service";

const CURSOR_VERSION = 1;

interface ListCursor {
  v: number;
  updatedAt: number;
  id: string;
}

interface ListRow {
  id: string;
  key: string;
  revision: number;
  kind: string | null;
  status: string;
  snippet: string | null;
  createdAt: number;
  updatedAt: number;
}

const MAX_LIST_CURSOR_LENGTH = 512;

function invalidCursor(): never {
  throw new MemoryServiceError("INVALID_INPUT", "memory_list cursor is invalid");
}

function decodeListCursor(value: string): ListCursor {
  const cursor = decodeCursor(value, MAX_LIST_CURSOR_LENGTH) ?? invalidCursor();
  if (
    Object.keys(cursor).length !== 3
    || cursor.v !== CURSOR_VERSION
    || !Number.isSafeInteger(cursor.updatedAt)
    || (cursor.updatedAt as number) < 0
    || typeof cursor.id !== "string"
    || !/^mem_[a-f0-9]{32}$/.test(cursor.id)
  ) return invalidCursor();
  return cursor as unknown as ListCursor;
}

function encodeListCursor(row: ListRow): string {
  return encodeCursor({ v: CURSOR_VERSION, updatedAt: row.updatedAt, id: row.id });
}

export async function listMemories(
  db: D1Database,
  actor: ActorContext,
  request: ListMemoryRequest,
  now: number,
): Promise<MemoryListResult> {
  const conditions = [
    "p.owner_id = ?",
    "p.slug = ?",
    "m.namespace = ?",
    "m.indexable = 1",
    "m.deleted = 0",
    "(m.expires_at IS NULL OR m.expires_at > ?)",
  ];
  const bindings: unknown[] = [actor.ownerId, request.project, request.namespace, now];
  // tag-all stays list-only: the shared clause builder only emits the tag-any form.
  const { tagMatch, ...fieldFilters } = request.filters ?? {};
  const useAllTags = tagMatch === "all" && (fieldFilters.tags?.length ?? 0) > 0;
  const filters = memoryFilterClauses(useAllTags ? { ...fieldFilters, tags: undefined } : fieldFilters, "m");
  if (filters.sql) conditions.push(filters.sql.slice(" AND ".length));
  bindings.push(...filters.values);
  if (useAllTags) {
    for (const tag of fieldFilters.tags!) {
      conditions.push("EXISTS (SELECT 1 FROM memory_tags mt WHERE mt.memory_id = m.id AND mt.tag = ?)");
      bindings.push(tag);
    }
  }
  if (request.cursor !== undefined) {
    const cursor = decodeListCursor(request.cursor);
    conditions.push("(m.updated_at < ? OR (m.updated_at = ? AND m.id < ?))");
    bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }

  const rows = await db.prepare(
    `SELECT m.id, m.key, m.current_revision AS revision, m.kind, m.status,
            d.snippet, m.created_at AS createdAt, m.updated_at AS updatedAt
     FROM memories m
     JOIN projects p ON p.id = m.project_id
     LEFT JOIN memory_search_docs d ON d.memory_id = m.id AND d.revision = m.current_revision
     WHERE ${conditions.join(" AND ")}
     ORDER BY m.updated_at DESC, m.id DESC
     LIMIT ?`,
  ).bind(...bindings, request.limit + 1).all<ListRow>();

  const page = rows.results.slice(0, request.limit);
  const tagsByMemory = await loadMemoryTags(db, page.map((row) => row.id));

  const items: MemoryListItem[] = page.map((row) => ({
    project: request.project,
    namespace: request.namespace,
    key: row.key,
    revision: row.revision,
    ...(row.kind === null ? {} : { kind: row.kind }),
    tags: tagsByMemory.get(row.id) ?? [],
    status: row.status,
    ...(row.snippet === null ? {} : { snippet: row.snippet }),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
  return {
    items,
    ...(rows.results.length > request.limit ? { nextCursor: encodeListCursor(page[page.length - 1]!) } : {}),
  };
}
