import type { MemoryRecord } from "../domain/memory";
import {
  PROFILE_BODY,
  PROFILE_GLOBAL_KEY,
  PROFILE_NAMESPACE,
  PROFILE_OKF_TYPE,
  PROFILE_PROJECT,
  PROFILE_PROJECT_KEY_PREFIX,
  PROFILE_VERSION,
} from "../domain/profile";
import { OKF_VERSION } from "../domain/okf";
import type { ReplayableMemoryService } from "../application/memory-service";
import { MemoryServiceError } from "../application/memory-service";
import { parseProfileOkf } from "./document";
import type { ProfileDocument } from "./types";

export interface StoredProfile {
  revision: number;
  document: ProfileDocument;
  canonical: string;
}

export function profileKey(project?: string): string {
  return project === undefined ? PROFILE_GLOBAL_KEY : `${PROFILE_PROJECT_KEY_PREFIX}${project}`;
}

export function emptyProfile(project?: string): ProfileDocument {
  return {
    frontmatter: {
      okf_version: OKF_VERSION,
      type: PROFILE_OKF_TYPE,
      profile_version: PROFILE_VERSION,
      scope: project === undefined ? "global" : "project",
      ...(project === undefined ? {} : { project }),
      sections: Object.create(null),
    },
    body: PROFILE_BODY,
  };
}

export function storedProfile(record: MemoryRecord | null): StoredProfile | undefined {
  if (!record) return undefined;
  if (!record.okfMarkdown) throw new MemoryServiceError("INTERNAL_ERROR", "Stored profile document is unavailable");
  try {
    const document = parseProfileOkf(record.okfMarkdown);
    return { revision: record.revision, document, canonical: record.okfMarkdown };
  } catch {
    throw new MemoryServiceError("INTERNAL_ERROR", "Stored profile document is invalid");
  }
}

export async function readProfile(memory: ReplayableMemoryService, project?: string): Promise<StoredProfile | undefined> {
  return storedProfile(await memory.retrieve({
    project: PROFILE_PROJECT,
    namespace: PROFILE_NAMESPACE,
    key: profileKey(project),
  }));
}
