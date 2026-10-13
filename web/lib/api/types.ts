import type {
  DeleteInput,
  GetLastInput,
  GraphInput,
  HistoryInput,
  ListInput,
  RetrieveInput,
  RetrieveRevisionInput,
  RestoreInput,
  SearchInput,
  StoreInput,
  UpdateLastInput,
} from "../../../server/mcp/memory-contracts";
import type { ProfileDeleteInput, ProfileGetInput, ProfileUpdateInput } from "../../../server/mcp/profile-contracts";
import type {
  MemoryListResult,
  MemoryRecord,
  MutationResult,
  SearchResult,
} from "../../../server/domain/memory";
import type {
  ProfileDeleteResult,
  ProfileGetResult,
  ProfileUpdateResult,
} from "../../../server/profile/profile-service";
import type { AttachmentMetadata as ServerAttachmentMetadata } from "../../../server/attachments/types";
import type { MaintenanceStatus } from "../../../server/maintenance/status";
import type {
  MaintenanceProcessResult,
  MaintenanceReindexResult,
  MaintenanceResult,
} from "../../../server/http/services";

export type WorkmoryToolInputMap = {
  memory_store: StoreInput;
  memory_retrieve: RetrieveInput;
  memory_history: HistoryInput;
  memory_retrieve_revision: RetrieveRevisionInput;
  memory_restore: RestoreInput;
  memory_list: ListInput;
  memory_search: SearchInput;
  memory_graph: GraphInput;
  memory_delete: DeleteInput;
  memory_get_last: GetLastInput;
  memory_update_last: UpdateLastInput;
  profile_get: ProfileGetInput;
  profile_update: ProfileUpdateInput;
  profile_delete: ProfileDeleteInput;
};

export type WorkmoryToolName = keyof WorkmoryToolInputMap;

export type WorkmoryToolOutputMap = {
  memory_store: { record: MemoryRecord };
  memory_retrieve: { record: MemoryRecord | null };
  memory_history: import("../../../server/application/memory-service").MemoryHistoryResult;
  memory_retrieve_revision: { result: import("../../../server/application/memory-service").MemoryRevisionResult };
  memory_restore: { record: MemoryRecord };
  memory_list: MemoryListResult;
  memory_search: { result: SearchResult };
  memory_graph: { graph: import("../../../server/application/memory-service").MemoryGraphResult };
  memory_delete: { result: MutationResult };
  memory_get_last: { record: MemoryRecord | null };
  memory_update_last: { record: MemoryRecord };
  profile_get: { profile: ProfileGetResult };
  profile_update: { profile: ProfileUpdateResult };
  profile_delete: { result: ProfileDeleteResult };
};

export type AttachmentMetadata = ServerAttachmentMetadata;

export type MaintenanceAction = "status" | "process" | "reindex";
export type { MaintenanceProcessResult, MaintenanceReindexResult, MaintenanceResult };
export type { ProjectDirectoryEntry, ProjectDirectoryResult } from "../../../server/application/project-directory";
export type { MaintenanceStatus, MemoryListResult, MemoryRecord, MutationResult, SearchResult };
export type {
  MemoryGraphCoverage,
  MemoryGraphDirection,
  MemoryGraphEdge,
  MemoryGraphNode,
  MemoryGraphRequest,
  MemoryGraphResult,
  MemoryGraphTruncationReason,
} from "../../../server/application/memory-service";
