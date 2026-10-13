import { beforeEach, describe, expect, it } from "vitest";
import { D1ProjectDirectoryService } from "../../server/application/project-directory";
import type { ActorContext } from "../../server/domain/identity";
import { PROFILE_PROJECT } from "../../server/domain/profile";
import { accessActor, resetTestEnv, testEnv } from "./helpers";

const rootActor: ActorContext = { ownerId: "root", actorId: "root", authKind: "root" };
const directory = (actor: ActorContext) => new D1ProjectDirectoryService(testEnv.DB, actor);

async function insertProject(id: string, owner: string, slug: string): Promise<void> {
  await testEnv.DB.prepare("INSERT INTO projects (id, owner_id, slug, created_at) VALUES (?, ?, ?, 0)")
    .bind(id, owner, slug).run();
}

async function insertMemory(
  id: string,
  projectId: string,
  namespace: string,
  values = "",
  updatedAt = 0,
): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO memories
       (id, project_id, namespace, key, current_revision, status, deleted, indexable, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, '${values.includes("other-status") ? "future-status" : "stable"}', ${values.includes("deleted") ? 1 : 0}, ${values.includes("non-indexable") ? 0 : 1}, ${values.includes("expired") ? 1 : "NULL"}, 0, ?)`,
  ).bind(id, projectId, namespace, id, updatedAt).run();
}

async function insertMemoryWithStatus(id: string, projectId: string, status: string): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO memories
       (id, project_id, namespace, key, current_revision, status, deleted, indexable, created_at, updated_at)
     VALUES (?, ?, 'default', ?, 1, ?, 0, 1, 0, 0)`,
  ).bind(id, projectId, id, status).run();
}

beforeEach(resetTestEnv);

describe("D1 project directory", () => {
  it("isolates Access owners and root while excluding only the internal profile project", async () => {
    await insertProject("a-alpha", "owner-a", "alpha");
    await insertProject("b-alpha", "owner-b", "alpha");
    await insertProject("root-alpha", "root", "alpha");
    await insertProject("profile", "owner-a", PROFILE_PROJECT);
    await insertMemory("a-memory", "a-alpha", "profile");
    await insertMemory("b-memory", "b-alpha", "private-b");
    await insertMemory("root-memory", "root-alpha", "private-root");
    await insertMemory("profile-memory", "profile", "profile");

    expect(await directory(accessActor("owner-a")).list()).toEqual({ projects: [{ project: "alpha", namespaces: ["profile"], memoryCount: 1, statusCounts: { stable: 1 }, lastMemoryUpdatedAt: "1970-01-01T00:00:00.000Z" }] });
    expect(await directory(accessActor("owner-b")).list()).toEqual({ projects: [{ project: "alpha", namespaces: ["private-b"], memoryCount: 1, statusCounts: { stable: 1 }, lastMemoryUpdatedAt: "1970-01-01T00:00:00.000Z" }] });
    expect(await directory(rootActor).list()).toEqual({ projects: [{ project: "alpha", namespaces: ["private-root"], memoryCount: 1, statusCounts: { stable: 1 }, lastMemoryUpdatedAt: "1970-01-01T00:00:00.000Z" }] });
  });

  it("keeps attachment-only projects and all persistent memory identities, distinct and BINARY sorted", async () => {
    await insertProject("z", "owner-a", "zeta");
    await insertProject("a", "owner-a", "Alpha");
    await testEnv.DB.prepare(
      `INSERT INTO attachments
       (id, project_id, status, source_kind, filename, detected_mime, original_size, original_sha256,
        original_r2_key, actor_id, idempotency_key, fingerprint, created_at, updated_at)
       VALUES ('attachment-only', 'a', 'ready', 'upload', 'note.txt', 'text/plain', 1, 'hash',
               'opaque-key', 'actor', 'operation', 'fingerprint', 0, 0)`,
    ).run();
    await insertMemory("deleted", "z", "deleted-only", "deleted");
    await insertMemory("expired", "z", "expired-only", "expired");
    await insertMemory("hidden", "z", "non-indexable-only", "non-indexable", 1000);
    await insertMemory("other-status", "z", "other-status-only", "other-status", 2000);
    await insertMemory("duplicate-a", "z", "same");
    await insertMemory("duplicate-b", "z", "same");

    expect(await directory(accessActor("owner-a")).list()).toEqual({ projects: [
      { project: "Alpha", namespaces: [], memoryCount: 0, statusCounts: {} },
      {
        project: "zeta",
        namespaces: ["deleted-only", "expired-only", "non-indexable-only", "other-status-only", "same"],
        memoryCount: 4,
        statusCounts: { "future-status": 1, stable: 3 },
        lastMemoryUpdatedAt: "1970-01-01T00:00:02.000Z",
      },
    ] });
  });

  it("returns an empty directory for an empty database", async () => {
    await expect(directory(accessActor("owner-a")).list()).resolves.toEqual({ projects: [] });
  });

  it("accepts 1000 entries and rejects 1001 without returning a partial directory", async () => {
    await testEnv.DB.prepare(
      `WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 1000)
       INSERT INTO projects (id, owner_id, slug, created_at)
       SELECT printf('project-%04d', n), 'owner-a', printf('project-%04d', n), 0 FROM numbers`,
    ).run();
    expect((await directory(accessActor("owner-a")).list()).projects).toHaveLength(1000);

    await insertMemory("over-limit", "project-0001", "default");
    await expect(directory(accessActor("owner-a")).list()).rejects.toMatchObject({ code: "PROJECT_DIRECTORY_TOO_LARGE" });
  });

  it("bounds open-world status groups independently of directory entries", async () => {
    await insertProject("many-statuses", "owner-a", "many-statuses");
    await testEnv.DB.prepare(
      `WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 1000)
       INSERT INTO memories
         (id, project_id, namespace, key, current_revision, status, deleted, indexable, created_at, updated_at)
       SELECT printf('memory-%04d', n), 'many-statuses', 'default', printf('key-%04d', n), 1,
              printf('status-%04d', n), 0, 1, 0, 0
       FROM numbers`,
    ).run();

    const result = await directory(accessActor("owner-a")).list();
    expect(Object.keys(result.projects[0]!.statusCounts)).toHaveLength(1000);

    await insertMemoryWithStatus("memory-1001", "many-statuses", "status-1001");
    await expect(directory(accessActor("owner-a")).list()).rejects.toMatchObject({ code: "PROJECT_DIRECTORY_TOO_LARGE" });
  });

  it("rejects status names whose total UTF-8 size exceeds 1 MiB", async () => {
    await insertProject("large-statuses", "owner-a", "large-statuses");
    for (let index = 0; index < 5; index += 1) {
      await insertMemoryWithStatus(`memory-${index}`, "large-statuses", `${"a".repeat(210_000)}${index}`);
    }

    await expect(directory(accessActor("owner-a")).list()).rejects.toMatchObject({ code: "PROJECT_DIRECTORY_TOO_LARGE" });
  });

  it("measures multibyte status names in UTF-8 bytes rather than JavaScript characters", async () => {
    await insertProject("multibyte-statuses", "owner-a", "multibyte-statuses");
    for (let index = 0; index < 4; index += 1) {
      await insertMemoryWithStatus(`memory-${index}`, "multibyte-statuses", `${"界".repeat(90_000)}${index}`);
    }

    await expect(directory(accessActor("owner-a")).list()).rejects.toMatchObject({ code: "PROJECT_DIRECTORY_TOO_LARGE" });
  });
});
