import { memoryOpaqueId } from "../domain/identity";
import type { ExtractedMemoryLink } from "../domain/memory-links";

const LINKS_PER_STATEMENT = 10;

interface LinkInsertInput {
  sourceMemoryId: string;
  sourceRevision: number;
  projectId: string;
  namespace: string;
  links: ExtractedMemoryLink[];
  guard?: { sql: string; bindings: unknown[] };
}

export async function memoryLinkInsertStatements(db: D1Database, input: LinkInsertInput): Promise<D1PreparedStatement[]> {
  const rows = await Promise.all(input.links.map(async (link) => [
    input.sourceMemoryId,
    input.sourceRevision,
    await memoryOpaqueId(input.projectId, input.namespace, link.targetKey),
    link.targetKey,
    link.origin,
    link.rawTarget,
    link.ordinal,
  ]));
  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < rows.length; offset += LINKS_PER_STATEMENT) {
    const chunk = rows.slice(offset, offset + LINKS_PER_STATEMENT);
    const values = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
    const bindings = chunk.flat();
    if (input.guard) {
      statements.push(db.prepare(
        `WITH links(source_memory_id, source_revision, target_memory_id, target_key, origin, raw_target, ordinal) AS (VALUES ${values})
         INSERT INTO memory_links SELECT * FROM links WHERE ${input.guard.sql}`,
      ).bind(...bindings, ...input.guard.bindings));
    } else {
      statements.push(db.prepare(
        `INSERT INTO memory_links (source_memory_id, source_revision, target_memory_id, target_key, origin, raw_target, ordinal) VALUES ${values}`,
      ).bind(...bindings));
    }
  }
  return statements;
}
