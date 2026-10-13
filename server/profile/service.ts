import { z } from "zod";
import { projectSchema } from "../domain/contracts";
import { PROFILE_NAMESPACE, PROFILE_PROJECT } from "../domain/profile";
import type { ReplayableMemoryService } from "../application/memory-service";
import { MemoryServiceError } from "../application/memory-service";
import { profileDeleteFingerprint, profileUpdateFingerprint } from "./fingerprint";
import { mergeProfiles } from "./merge";
import { patchValidatedProfile, serializeProfileOkf } from "./document";
import { parseProfileOperations, profileErrorMessage, ProfileValidationError } from "./schema";
import { emptyProfile, profileKey, readProfile, storedProfile, type StoredProfile } from "./profile-storage";
import type { ProfileScope } from "./types";
import type {
  ProfileDeleteRequest,
  ProfileDeleteResult,
  ProfileGetRequest,
  ProfileGetResult,
  ProfileService,
  ProfileUpdateRequest,
  ProfileUpdateResult,
} from "./profile-service";

function validateProject(project?: string): void {
  if (project !== undefined && !projectSchema.safeParse(project).success) {
    throw new MemoryServiceError("INVALID_INPUT", "project must be a stable identifier");
  }
}

async function withServiceErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProfileValidationError) throw new MemoryServiceError("INVALID_INPUT", error.message);
    if (error instanceof z.ZodError) throw new MemoryServiceError("INVALID_INPUT", profileErrorMessage(error));
    throw error;
  }
}

export class MemoryProfileService implements ProfileService {
  constructor(private readonly memory: ReplayableMemoryService, private readonly now: () => Date = () => new Date()) {}

  private result(
    global: StoredProfile | undefined,
    project: StoredProfile | undefined,
    request: ProfileGetRequest,
  ): ProfileGetResult {
    const merged = mergeProfiles(
      global?.document ?? emptyProfile(),
      request.project === undefined ? undefined : project?.document ?? emptyProfile(request.project),
      { includeSensitive: request.includeSensitive, now: this.now() },
    );
    return {
      effective: merged.sections,
      globalRevision: global?.revision,
      projectRevision: project?.revision,
      staleFields: merged.staleFields,
      maskedFields: merged.maskedFields,
      ...(request.includeRaw ? { raw: { global: global?.canonical, project: project?.canonical } } : {}),
    };
  }

  private async updateResult(
    scope: ProfileScope,
    projectName: string | undefined,
    stored: StoredProfile,
  ): Promise<ProfileUpdateResult> {
    const global = scope === "global" ? stored : await readProfile(this.memory);
    const project = scope === "project" ? stored : undefined;
    return {
      ...this.result(global, project, { project: projectName }),
      target: { scope, project: projectName, revision: stored.revision },
    };
  }

  async get(request: ProfileGetRequest): Promise<ProfileGetResult> {
    return withServiceErrors(async () => {
      validateProject(request.project);
      if (request.includeRaw && !request.includeSensitive) {
        throw new MemoryServiceError("INVALID_INPUT", "include_raw requires include_sensitive");
      }
      const [global, project] = await Promise.all([
        readProfile(this.memory),
        request.project === undefined ? undefined : readProfile(this.memory, request.project),
      ]);
      return this.result(global, project, request);
    });
  }

  async update(request: ProfileUpdateRequest): Promise<ProfileUpdateResult> {
    return withServiceErrors(async () => {
      validateProject(request.project);
      const scope: ProfileScope = request.project === undefined ? "global" : "project";
      const operationFingerprint = await profileUpdateFingerprint({
        scope,
        project: request.project,
        expectedRevision: request.expectedRevision,
        operations: request.operations,
      });
      const replay = await this.memory.replayCompletedOperation({
        project: PROFILE_PROJECT,
        namespace: PROFILE_NAMESPACE,
        key: profileKey(request.project),
        action: "upsert",
        operationId: request.operationId,
        operationFingerprint,
      });
      if (replay?.action === "upsert") {
        const stored = storedProfile(replay.record);
        if (!stored) throw new MemoryServiceError("INTERNAL_ERROR", "Stored profile document is unavailable");
        return this.updateResult(scope, request.project, stored);
      }
      const normalized = parseProfileOperations(request.operations, scope);
      const current = await readProfile(this.memory, request.project);
      const currentRevision = current?.revision ?? 0;
      const document = patchValidatedProfile(current?.document ?? emptyProfile(request.project), normalized);
      const stored = storedProfile(await this.memory.store({
        project: PROFILE_PROJECT,
        namespace: PROFILE_NAMESPACE,
        key: profileKey(request.project),
        source: { okf_markdown: serializeProfileOkf(document) },
        expectedRevision: request.expectedRevision ?? currentRevision,
        operationId: request.operationId,
        operationFingerprint,
        indexable: false,
      }));
      if (!stored) throw new MemoryServiceError("INTERNAL_ERROR", "Stored profile document is unavailable");
      return this.updateResult(scope, request.project, stored);
    });
  }

  async delete(request: ProfileDeleteRequest): Promise<ProfileDeleteResult> {
    return withServiceErrors(async () => {
      validateProject(request.project);
      const scope: ProfileScope = request.project === undefined ? "global" : "project";
      const operationFingerprint = await profileDeleteFingerprint({
        scope,
        project: request.project,
        expectedRevision: request.expectedRevision,
      });
      const replay = await this.memory.replayCompletedOperation({
        project: PROFILE_PROJECT,
        namespace: PROFILE_NAMESPACE,
        key: profileKey(request.project),
        action: "delete",
        operationId: request.operationId,
        operationFingerprint,
      });
      if (replay?.action === "delete") return { ...replay.result, scope, project: request.project };
      const current = await readProfile(this.memory, request.project);
      const result = await this.memory.delete({
        project: PROFILE_PROJECT,
        namespace: PROFILE_NAMESPACE,
        key: profileKey(request.project),
        expectedRevision: request.expectedRevision ?? current?.revision,
        operationId: request.operationId,
        operationFingerprint,
      });
      return { ...result, scope, project: request.project };
    });
  }
}

export function createProfileService(memory: ReplayableMemoryService, now?: () => Date): ProfileService {
  return new MemoryProfileService(memory, now);
}
