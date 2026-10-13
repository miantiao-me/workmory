import { and, asc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { memories, projects } from "../db/schema";
import type { ActorContext } from "../domain/identity";
import { PROFILE_PROJECT } from "../domain/profile";

const DIRECTORY_ENTRY_LIMIT = 1000;
const STATUS_NAME_BYTES_LIMIT = 1024 * 1024;

export interface ProjectDirectoryEntry {
  project: string;
  namespaces: string[];
  memoryCount: number;
  statusCounts: Record<string, number>;
  lastMemoryUpdatedAt?: string;
}

export interface ProjectDirectoryResult {
  projects: ProjectDirectoryEntry[];
}

export interface ProjectDirectoryService {
  list(): Promise<ProjectDirectoryResult>;
}

export class ProjectDirectoryError extends Error {
  readonly code = "PROJECT_DIRECTORY_TOO_LARGE";

  constructor() {
    super("Project directory exceeds the supported size");
    this.name = "ProjectDirectoryError";
  }
}

export class D1ProjectDirectoryService implements ProjectDirectoryService {
  private readonly orm;

  constructor(db: D1Database, private readonly actor: ActorContext) {
    this.orm = drizzle(db, { schema: { projects, memories } });
  }

  async list(): Promise<ProjectDirectoryResult> {
    const now = Date.now();
    const rows = await this.orm
      .selectDistinct({ project: projects.slug, namespace: memories.namespace })
      .from(projects)
      .leftJoin(memories, eq(memories.projectId, projects.id))
      .where(and(eq(projects.ownerId, this.actor.ownerId), ne(projects.slug, PROFILE_PROJECT)))
      .orderBy(asc(sql`${projects.slug} collate binary`), asc(sql`${memories.namespace} collate binary`))
      .limit(DIRECTORY_ENTRY_LIMIT + 1);

    if (rows.length > DIRECTORY_ENTRY_LIMIT) throw new ProjectDirectoryError();

    const directory: ProjectDirectoryEntry[] = [];
    const entriesByProject = new Map<string, ProjectDirectoryEntry>();
    let entryCount = 0;
    for (const row of rows) {
      let entry = directory[directory.length - 1];
      if (!entry || entry.project !== row.project) {
        entry = { project: row.project, namespaces: [], memoryCount: 0, statusCounts: {} };
        directory.push(entry);
        entriesByProject.set(entry.project, entry);
        entryCount += 1;
      }
      if (row.namespace !== null) {
        entry.namespaces.push(row.namespace);
        entryCount += 1;
      }
      if (entryCount > DIRECTORY_ENTRY_LIMIT) throw new ProjectDirectoryError();
    }

    const statusGroups = this.orm
      .select({
        statusBytes: sql<number>`length(cast(${memories.status} as blob))`.as("status_bytes"),
      })
      .from(projects)
      .innerJoin(memories, eq(memories.projectId, projects.id))
      .where(and(
        eq(projects.ownerId, this.actor.ownerId),
        ne(projects.slug, PROFILE_PROJECT),
        eq(memories.deleted, false),
        or(isNull(memories.expiresAt), gt(memories.expiresAt, now)),
      ))
      .groupBy(projects.slug, memories.status)
      .as("status_groups");
    const [statusSummary] = await this.orm
      .select({
        groupCount: sql<number>`count(*)`,
        statusBytes: sql<number>`coalesce(sum(${statusGroups.statusBytes}), 0)`,
      })
      .from(statusGroups);

    if (
      Number(statusSummary?.groupCount ?? 0) > DIRECTORY_ENTRY_LIMIT
      || Number(statusSummary?.statusBytes ?? 0) > STATUS_NAME_BYTES_LIMIT
    ) {
      throw new ProjectDirectoryError();
    }

    const statusRows = await this.orm
      .select({
        project: projects.slug,
        status: memories.status,
        memoryCount: sql<number>`count(*)`,
        lastMemoryUpdatedAt: sql<number>`max(${memories.updatedAt})`,
      })
      .from(projects)
      .innerJoin(memories, eq(memories.projectId, projects.id))
      .where(and(
        eq(projects.ownerId, this.actor.ownerId),
        ne(projects.slug, PROFILE_PROJECT),
        eq(memories.deleted, false),
        or(isNull(memories.expiresAt), gt(memories.expiresAt, now)),
      ))
      .groupBy(projects.slug, memories.status)
      .orderBy(asc(sql`${projects.slug} collate binary`), asc(sql`${memories.status} collate binary`))
      .limit(DIRECTORY_ENTRY_LIMIT + 1);

    // Keep the fetch limit as defense in depth against an inconsistent aggregate result.
    if (statusRows.length > DIRECTORY_ENTRY_LIMIT) throw new ProjectDirectoryError();

    for (const row of statusRows) {
      const entry = entriesByProject.get(row.project);
      if (!entry) continue;
      const count = Number(row.memoryCount);
      const updatedAt = Number(row.lastMemoryUpdatedAt);
      Object.defineProperty(entry.statusCounts, row.status, {
        value: count,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      entry.memoryCount += count;
      if (entry.lastMemoryUpdatedAt === undefined || updatedAt > Date.parse(entry.lastMemoryUpdatedAt)) {
        entry.lastMemoryUpdatedAt = new Date(updatedAt).toISOString();
      }
    }
    return { projects: directory };
  }
}
