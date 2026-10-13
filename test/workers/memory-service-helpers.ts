import type { ActorContext } from "../../server/domain/identity";
import { createMemoryService } from "../../server/application/d1-memory-service";
import type { ReplayableMemoryService } from "../../server/application/memory-service";
import { accessActor, testEnv } from "./helpers";

export function memoryService(
  actor: ActorContext = accessActor("subject-a"),
  options?: Parameters<typeof createMemoryService>[2],
): ReplayableMemoryService {
  return createMemoryService({ DB: testEnv.DB, BUCKET: testEnv.BUCKET }, actor, options);
}
