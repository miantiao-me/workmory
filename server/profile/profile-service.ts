import type { MutationResult } from "../domain/memory";
import type { EffectiveProfile, ProfileFieldPath, ProfilePatchOperation } from "./types";

export interface ProfileGetRequest {
  project?: string;
  includeSensitive?: boolean;
  includeRaw?: boolean;
}

export interface ProfileGetResult {
  effective: EffectiveProfile["sections"];
  globalRevision?: number;
  projectRevision?: number;
  staleFields: ProfileFieldPath[];
  maskedFields: ProfileFieldPath[];
  raw?: { global?: string; project?: string };
}

export interface ProfileUpdateRequest {
  project?: string;
  operations: readonly ProfilePatchOperation[];
  expectedRevision?: number;
  operationId?: string;
}

export interface ProfileUpdateResult extends Omit<ProfileGetResult, "raw"> {
  target: {
    scope: "global" | "project";
    project?: string;
    revision: number;
  };
}

export interface ProfileDeleteRequest {
  project?: string;
  expectedRevision?: number;
  operationId?: string;
}

export interface ProfileDeleteResult extends MutationResult {
  scope: "global" | "project";
  project?: string;
}

export interface ProfileService {
  get(request: ProfileGetRequest): Promise<ProfileGetResult>;
  update(request: ProfileUpdateRequest): Promise<ProfileUpdateResult>;
  delete(request: ProfileDeleteRequest): Promise<ProfileDeleteResult>;
}
