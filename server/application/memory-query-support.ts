export interface MemoryFieldFilters {
  kind?: string;
  status?: string;
  tags?: string[];
}

// Builds SQL predicates for the shared kind/status/tag-any filter surface.
// `alias` is the table carrying kind/status (`m` for list, `s` for search).
// The tags EXISTS subquery always joins through the memories table alias `m`,
// which every caller already JOINs under that name.
export function memoryFilterClauses(filters: MemoryFieldFilters | undefined, alias: string): { sql: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (filters?.kind !== undefined) {
    clauses.push(`${alias}.kind = ?`);
    values.push(filters.kind);
  }
  if (filters?.status !== undefined) {
    clauses.push(`${alias}.status = ?`);
    values.push(filters.status);
  }
  if (filters?.tags?.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM memory_tags mt WHERE mt.memory_id = m.id AND mt.tag IN (${filters.tags.map(() => "?").join(",")}))`,
    );
    values.push(...filters.tags);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", values };
}

// D1 caps bound parameters at 100, so ID sets travel as one JSON array.
export async function loadMemoryTags(db: D1Database, memoryIds: string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(memoryIds)];
  const tags = new Map<string, string[]>();
  if (ids.length === 0) return tags;
  const rows = await db.prepare(
    `SELECT memory_id AS memoryId, tag FROM memory_tags
     WHERE memory_id IN (SELECT value FROM json_each(?)) ORDER BY memory_id, tag`,
  ).bind(JSON.stringify(ids)).all<{ memoryId: string; tag: string }>();
  for (const row of rows.results) {
    const current = tags.get(row.memoryId) ?? [];
    current.push(row.tag);
    tags.set(row.memoryId, current);
  }
  return tags;
}
