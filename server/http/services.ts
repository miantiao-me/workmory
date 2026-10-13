import { AttachmentService } from "../attachments/service";
import { WorkersAiMarkdownConverter } from "../attachments/converter";
import type { MemoryService } from "../application/memory-service";
import { createMemoryService } from "../application/d1-memory-service";
import type { ActorContext } from "../domain/identity";
import type { ProfileService } from "../profile/profile-service";
import { createProfileService } from "../profile/service";
import { createCloudflareSemanticRuntime } from "../search/cloudflare-adapters";
import { R2AttachmentObjectStore } from "../storage/attachment-object-store";
import type { RuntimeBindings } from "../env";
import { createMaintenanceService, type MaintenanceAction, type MaintenanceResult } from "../maintenance/maintenance-service";
import { D1ProjectDirectoryService, type ProjectDirectoryService } from "../application/project-directory";

export type { MaintenanceAction, MaintenanceProcessResult, MaintenanceReindexResult, MaintenanceResult } from "../maintenance/maintenance-service";

export interface RequestServices {
  attachments: AttachmentService;
  memory: MemoryService;
  profile: ProfileService;
  projectDirectory: ProjectDirectoryService;
  maintenance(action?: MaintenanceAction): Promise<MaintenanceResult>;
}

export function createRequestServices(
  env: RuntimeBindings,
  actor: ActorContext,
  defer: (promise: Promise<unknown>) => void,
): RequestServices {
  const semantic = createCloudflareSemanticRuntime(env);
  const attachmentObjects = new R2AttachmentObjectStore(env.BUCKET);
  const attachments = new AttachmentService(
    env.DB,
    attachmentObjects,
    new WorkersAiMarkdownConverter(env.AI),
    actor,
  );
  const memory = createMemoryService(
    { DB: env.DB, BUCKET: env.BUCKET },
    actor,
    { semantic, defer, attachments },
  );
  return {
    attachments,
    memory,
    profile: createProfileService(memory),
    projectDirectory: new D1ProjectDirectoryService(env.DB, actor),
    maintenance: createMaintenanceService(env),
  };
}
