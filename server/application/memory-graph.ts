import type { ActorContext } from "../domain/identity";
import { MEMORY_LINK_EXTRACTOR_VERSION } from "../domain/memory-links";
import { decodeCursor, encodeCursor } from "../shared/cursor-codec";
import {
  MEMORY_GRAPH_CURSOR_MAX_LENGTH,
  type MemoryGraphCoverage,
  type MemoryGraphEdge,
  type MemoryGraphNode,
  type MemoryGraphRequest,
  type MemoryGraphResult,
  type MemoryGraphTruncationReason,
} from "./graph-contract";

export type { MemoryGraphRequest, MemoryGraphResult } from "./graph-contract";

import { loadMemoryTags } from "./memory-query-support";
import { MemoryServiceError } from "./memory-service";

interface VisibleRow {
  id: string;
  key: string;
  revision: number;
  kind: string | null;
  status: string;
  updatedAt: number;
}

interface EdgeRow {
  sourceMemoryId: string;
  sourceKey: string;
  sourceRevision: number;
  sourceKind: string | null;
  sourceStatus: string;
  sourceUpdatedAt: number;
  targetKey: string;
  targetMemoryId: string | null;
  targetRevision: number | null;
  targetKind: string | null;
  targetStatus: string | null;
  targetUpdatedAt: number | null;
  origin: "link" | "source";
  occurrences: number;
  resolved: number;
}

const CURSOR_VERSION = 1;

function invalidCursor(): never {
  throw new MemoryServiceError("INVALID_INPUT", "memory_graph cursor is invalid");
}

function decodeGraphCursor(value: string): Record<string, unknown> {
  return decodeCursor(value, MEMORY_GRAPH_CURSOR_MAX_LENGTH) ?? invalidCursor();
}

function visibleNode(row: VisibleRow, tags: string[] = []): MemoryGraphNode {
  return {
    key: row.key,
    resolved: true,
    tags,
    revision: row.revision,
    ...(row.kind === null ? {} : { kind: row.kind }),
    status: row.status,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function edgeSourceNode(row: EdgeRow, tags: Map<string, string[]>): MemoryGraphNode {
  return visibleNode({
    id: row.sourceMemoryId,
    key: row.sourceKey,
    revision: row.sourceRevision,
    kind: row.sourceKind,
    status: row.sourceStatus,
    updatedAt: row.sourceUpdatedAt,
  }, tags.get(row.sourceMemoryId) ?? []);
}

function edgeTargetNode(row: EdgeRow, tags: Map<string, string[]>): MemoryGraphNode {
  if (!row.resolved) return { key: row.targetKey, resolved: false, tags: [] };
  return {
    key: row.targetKey,
    resolved: true,
    tags: tags.get(row.targetMemoryId!) ?? [],
    revision: row.targetRevision!,
    ...(row.targetKind === null ? {} : { kind: row.targetKind }),
    status: row.targetStatus!,
    updatedAt: new Date(row.targetUpdatedAt!).toISOString(),
  };
}

async function coverage(
  db: D1Database,
  actor: ActorContext,
  scope: { project: string; namespace: string },
  now: number,
): Promise<MemoryGraphCoverage> {
  const row = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN i.memory_id IS NULL OR i.status <> 'complete' OR i.revision <> m.current_revision OR i.extractor_version <> ? THEN 1 ELSE 0 END), 0) AS pendingSources,
       COALESCE(SUM(CASE WHEN i.status = 'complete' AND i.revision = m.current_revision AND i.truncated = 1 THEN 1 ELSE 0 END), 0) AS truncatedSources
     FROM memories m JOIN projects p ON p.id = m.project_id
     LEFT JOIN memory_link_index i ON i.memory_id = m.id
     WHERE p.owner_id = ? AND p.slug = ? AND m.namespace = ?
       AND m.indexable = 1 AND m.deleted = 0
       AND m.current_object_key IS NOT NULL AND m.current_hash IS NOT NULL
       AND (m.expires_at IS NULL OR m.expires_at > ?)`,
  ).bind(MEMORY_LINK_EXTRACTOR_VERSION, actor.ownerId, scope.project, scope.namespace, now)
    .first<{ pendingSources: number; truncatedSources: number }>();
  const pendingSources = row?.pendingSources ?? 0;
  const truncatedSources = row?.truncatedSources ?? 0;
  return { complete: pendingSources === 0 && truncatedSources === 0, pendingSources, truncatedSources };
}

async function overview(
  db: D1Database,
  actor: ActorContext,
  request: Extract<MemoryGraphRequest, { mode: "overview" }>,
  now: number,
): Promise<MemoryGraphResult> {
  const bindings: unknown[] = [actor.ownerId, request.project, request.namespace, now];
  let cursorCondition = "";
  if (request.cursor) {
    const cursor = decodeGraphCursor(request.cursor);
    if (
      cursor.v !== CURSOR_VERSION || cursor.mode !== "overview" || cursor.project !== request.project
      || cursor.namespace !== request.namespace || cursor.nodeLimit !== request.nodeLimit || cursor.edgeLimit !== request.edgeLimit
      || typeof cursor.key !== "string" || typeof cursor.id !== "string"
    ) return invalidCursor();
    cursorCondition = "AND (m.key > ? OR (m.key = ? AND m.id > ?))";
    bindings.push(cursor.key, cursor.key, cursor.id);
  }
  const rows = await db.prepare(
    `SELECT m.id, m.key, m.current_revision AS revision, m.kind, m.status, m.updated_at AS updatedAt
     FROM memories m JOIN projects p ON p.id = m.project_id
     WHERE p.owner_id = ? AND p.slug = ? AND m.namespace = ? AND m.indexable = 1 AND m.deleted = 0
       AND m.current_object_key IS NOT NULL AND m.current_hash IS NOT NULL
       AND (m.expires_at IS NULL OR m.expires_at > ?) ${cursorCondition}
     ORDER BY m.key, m.id LIMIT ?`,
  ).bind(...bindings, request.nodeLimit + 1).all<VisibleRow>();
  const page = rows.results.slice(0, request.nodeLimit);
  const pageIds = page.map((row) => row.id);
  let edgeRows: { sourceKey: string; targetKey: string; origin: "link" | "source"; occurrences: number }[] = [];
  let edgeTruncated = false;
  if (pageIds.length > 0) {
    // D1 caps bound parameters at 100, so page IDs travel as one JSON array.
    const idsJson = JSON.stringify(pageIds);
    const result = await db.prepare(
      `SELECT sm.key AS sourceKey, tm.key AS targetKey, l.origin, COUNT(*) AS occurrences
       FROM memory_links l
       JOIN memories sm ON sm.id = l.source_memory_id JOIN projects sp ON sp.id = sm.project_id
       JOIN memories tm ON tm.id = l.target_memory_id JOIN projects tp ON tp.id = tm.project_id
       WHERE l.source_memory_id IN (SELECT value FROM json_each(?))
         AND l.target_memory_id IN (SELECT value FROM json_each(?))
         AND l.source_revision = sm.current_revision
         AND sm.current_object_key IS NOT NULL AND sm.current_hash IS NOT NULL
         AND tm.current_object_key IS NOT NULL AND tm.current_hash IS NOT NULL
         AND tm.project_id = sm.project_id AND tm.namespace = sm.namespace
         AND sp.owner_id = ? AND tp.owner_id = ? AND sp.slug = ? AND tp.slug = ?
       GROUP BY l.source_memory_id, l.target_memory_id, l.origin
       ORDER BY sm.key, tm.key, l.origin LIMIT ?`,
    ).bind(idsJson, idsJson, actor.ownerId, actor.ownerId, request.project, request.project, request.edgeLimit + 1).all<typeof edgeRows[number]>();
    edgeTruncated = result.results.length > request.edgeLimit;
    edgeRows = result.results.slice(0, request.edgeLimit);
  }
  const nodeTruncated = rows.results.length > request.nodeLimit;
  const reasons: MemoryGraphTruncationReason[] = [
    ...(nodeTruncated ? ["node_limit" as const] : []),
    ...(edgeTruncated ? ["edge_limit" as const] : []),
  ];
  const tags = await loadMemoryTags(db, pageIds);
  return {
    mode: "overview",
    nodes: page.map((row) => visibleNode(row, tags.get(row.id) ?? [])),
    edges: edgeRows.map((row) => ({ ...row, resolved: true })),
    ...(nodeTruncated ? { nextCursor: encodeCursor({ v: CURSOR_VERSION, mode: "overview", project: request.project, namespace: request.namespace, nodeLimit: request.nodeLimit, edgeLimit: request.edgeLimit, key: page.at(-1)!.key, id: page.at(-1)!.id }) } : {}),
    truncated: reasons.length > 0,
    truncationReasons: reasons,
    coverage: await coverage(db, actor, request, now),
  };
}

async function neighbors(
  db: D1Database,
  actor: ActorContext,
  request: Extract<MemoryGraphRequest, { mode: "neighbors" }>,
  now: number,
): Promise<MemoryGraphResult> {
  const root = await db.prepare(
    `SELECT m.id, m.key, m.current_revision AS revision, m.kind, m.status, m.updated_at AS updatedAt
     FROM memories m JOIN projects p ON p.id = m.project_id
     WHERE p.owner_id = ? AND p.slug = ? AND m.namespace = ? AND m.key = ?
       AND m.indexable = 1 AND m.deleted = 0
       AND m.current_object_key IS NOT NULL AND m.current_hash IS NOT NULL
       AND (m.expires_at IS NULL OR m.expires_at > ?)`,
  ).bind(actor.ownerId, request.project, request.namespace, request.rootKey, now).first<VisibleRow>();
  if (!root) throw new MemoryServiceError("NOT_FOUND", "Memory was not found");

  let after = "";
  const cursorBindings: unknown[] = [];
  if (request.cursor) {
    const cursor = decodeGraphCursor(request.cursor);
    if (
      cursor.v !== CURSOR_VERSION || cursor.mode !== "neighbors" || cursor.project !== request.project
      || cursor.namespace !== request.namespace || cursor.rootKey !== request.rootKey || cursor.direction !== request.direction
      || cursor.includeBroken !== request.includeBroken || cursor.edgeLimit !== request.edgeLimit || typeof cursor.sourceKey !== "string"
      || typeof cursor.targetKey !== "string" || !["link", "source"].includes(String(cursor.origin))
    ) return invalidCursor();
    after = "WHERE sourceKey > ? OR (sourceKey = ? AND (targetKey > ? OR (targetKey = ? AND origin > ?)))";
    cursorBindings.push(cursor.sourceKey, cursor.sourceKey, cursor.targetKey, cursor.targetKey, cursor.origin);
  }
  const directionCondition = request.direction === "outbound"
    ? "l.source_memory_id = ?"
    : request.direction === "inbound"
      ? "l.target_memory_id = ?"
      : "(l.source_memory_id = ? OR l.target_memory_id = ?)";
  const directionBindings = request.direction === "both" ? [root.id, root.id] : [root.id];
  const rows = await db.prepare(
    `WITH grouped AS (
       SELECT l.source_memory_id AS sourceMemoryId, sm.key AS sourceKey, sm.current_revision AS sourceRevision,
              sm.kind AS sourceKind, sm.status AS sourceStatus, sm.updated_at AS sourceUpdatedAt,
              COALESCE(tm.key, l.target_key) AS targetKey, tm.id AS targetMemoryId, tm.current_revision AS targetRevision,
              tm.kind AS targetKind, tm.status AS targetStatus, tm.updated_at AS targetUpdatedAt,
              l.origin, COUNT(*) AS occurrences, CASE WHEN tm.id IS NULL THEN 0 ELSE 1 END AS resolved
       FROM memory_links l
       JOIN memories sm ON sm.id = l.source_memory_id
       JOIN projects sp ON sp.id = sm.project_id
       LEFT JOIN memories tm ON tm.id = l.target_memory_id AND tm.indexable = 1 AND tm.deleted = 0
         AND tm.project_id = sm.project_id AND tm.namespace = sm.namespace
         AND tm.current_object_key IS NOT NULL AND tm.current_hash IS NOT NULL
         AND (tm.expires_at IS NULL OR tm.expires_at > ?)
         AND EXISTS (SELECT 1 FROM projects tp WHERE tp.id = tm.project_id AND tp.owner_id = ? AND tp.slug = ?)
       WHERE sp.owner_id = ? AND sp.slug = ? AND sm.namespace = ? AND sm.indexable = 1 AND sm.deleted = 0
         AND sm.current_object_key IS NOT NULL AND sm.current_hash IS NOT NULL
         AND (sm.expires_at IS NULL OR sm.expires_at > ?) AND l.source_revision = sm.current_revision AND ${directionCondition}
         AND (? = 1 OR tm.id IS NOT NULL)
       GROUP BY l.source_memory_id, l.target_memory_id, l.origin, resolved
     ) SELECT * FROM grouped ${after} ORDER BY sourceKey, targetKey, origin LIMIT ?`,
  ).bind(
    now,
    actor.ownerId,
    request.project,
    actor.ownerId,
    request.project,
    request.namespace,
    now,
    ...directionBindings,
    request.includeBroken ? 1 : 0,
    ...cursorBindings,
    request.edgeLimit + 1,
  ).all<EdgeRow>();
  const hasMore = rows.results.length > request.edgeLimit;
  const page = rows.results.slice(0, request.edgeLimit);
  const tags = await loadMemoryTags(db, [root.id, ...page.map((row) => row.sourceMemoryId), ...page.flatMap((row) => row.targetMemoryId ? [row.targetMemoryId] : [])]);
  const nodes = new Map<string, MemoryGraphNode>([[root.key, visibleNode(root, tags.get(root.id) ?? [])]]);
  for (const row of page) {
    nodes.set(row.sourceKey, edgeSourceNode(row, tags));
    const target = edgeTargetNode(row, tags);
    const current = nodes.get(target.key);
    if (!current?.resolved || target.resolved) nodes.set(target.key, target);
  }
  const last = page.at(-1);
  return {
    mode: "neighbors",
    nodes: [...nodes.values()],
    edges: page.map((row) => ({ sourceKey: row.sourceKey, targetKey: row.targetKey, origin: row.origin, occurrences: row.occurrences, resolved: Boolean(row.resolved) })),
    ...(hasMore && last ? { nextCursor: encodeCursor({
      v: CURSOR_VERSION,
      mode: "neighbors",
      project: request.project,
      namespace: request.namespace,
      rootKey: request.rootKey,
      direction: request.direction,
      includeBroken: request.includeBroken,
      edgeLimit: request.edgeLimit,
      sourceKey: last.sourceKey,
      targetKey: last.targetKey,
      origin: last.origin,
    }) } : {}),
    truncated: hasMore,
    truncationReasons: hasMore ? ["edge_limit"] : [],
    coverage: await coverage(db, actor, request, now),
  };
}

export function queryMemoryGraph(
  db: D1Database,
  actor: ActorContext,
  request: MemoryGraphRequest,
  now = Date.now(),
): Promise<MemoryGraphResult> {
  return request.mode === "overview" ? overview(db, actor, request, now) : neighbors(db, actor, request, now);
}
