import { applyD1Migrations, env } from "cloudflare:test";
import type { ActorContext } from "../../server/domain/identity";

interface TestEnv extends Env {
  TEST_MIGRATIONS: { name: string; queries: string[] }[];
}

export const testEnv = env as TestEnv;

export const accessActor = (ownerId = "subject-a"): ActorContext => ({
  ownerId,
  actorId: `access:${ownerId}`,
  authKind: "access",
});

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

export async function resetTestEnv(): Promise<void> {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.batch([
    testEnv.DB.prepare("DELETE FROM vector_staging"),
    testEnv.DB.prepare("DELETE FROM vector_cleanup"),
    testEnv.DB.prepare("DELETE FROM canonical_object_staging"),
    testEnv.DB.prepare("DELETE FROM operation_receipts"),
    testEnv.DB.prepare("DELETE FROM memory_links"),
    testEnv.DB.prepare("DELETE FROM memory_link_index"),
    testEnv.DB.prepare("DELETE FROM memory_revision_attachments"),
    testEnv.DB.prepare("DELETE FROM attachments"),
    testEnv.DB.prepare("DELETE FROM semantic_vectors"),
    testEnv.DB.prepare("DELETE FROM index_outbox"),
    testEnv.DB.prepare("DELETE FROM memory_tags"),
    testEnv.DB.prepare("DELETE FROM memory_search_docs"),
    testEnv.DB.prepare("DELETE FROM memory_revisions"),
    testEnv.DB.prepare("DELETE FROM memories"),
    testEnv.DB.prepare("DELETE FROM projects"),
  ]);
  const objectKeys: string[] = [];
  let cursor: string | undefined;
  do {
    const objects = await testEnv.BUCKET.list({ cursor });
    objectKeys.push(...objects.objects.map((object) => object.key));
    cursor = objects.truncated ? objects.cursor : undefined;
  } while (cursor);
  for (let offset = 0; offset < objectKeys.length; offset += 1_000) {
    await testEnv.BUCKET.delete(objectKeys.slice(offset, offset + 1_000));
  }
}
