// 最近附件列表只是索引而非数据副本：只存打开详情所需的最小字段，
// 绝不持久化正文、API key、溯源 URL 或其他敏感元数据。
//
// localStorage 按浏览器 origin 共享，UI 无法获得当前调用方是 root 还是
// Access owner，因此只能按 project 隔离；同一浏览器上的 owner 之间仍会
// 共享最近记录，这与 API key 保存在 localStorage 的已知模型一致。
import type { AttachmentMetadata } from "./api/types";

export interface AttachmentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type StoredAttachment = Pick<AttachmentMetadata, "id" | "project" | "filename" | "createdAt"> & {
  // 持久化值只要求字符串；附件生命周期未收窄，状态透传展示即可。
  status: string;
};

const STORAGE_PREFIX = "workmory.recent-attachments.v1.";
const MAX_RECENT = 5;
const ATTACHMENT_ID_PATTERN = /^att_[a-f0-9]{32}$/;

export function recentAttachmentKey(project: string): string {
  return `${STORAGE_PREFIX}${project}`;
}

function isStoredAttachment(value: unknown, project: string): value is StoredAttachment {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && ATTACHMENT_ID_PATTERN.test(record.id)
    && record.project === project
    && typeof record.filename === "string"
    && record.filename.length > 0
    && record.filename.length <= 2_048
    && typeof record.status === "string"
    && record.status.length <= 64
    && typeof record.createdAt === "string"
    && record.createdAt.length > 0
    && record.createdAt.length <= 64;
}

export function parseRecentAttachments(raw: string | null, project: string): StoredAttachment[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => isStoredAttachment(entry, project))
      .slice(0, MAX_RECENT);
  } catch {
    // 损坏的数据直接忽略，而不是让页面崩溃。
    return [];
  }
}

export function loadRecentAttachments(storage: Pick<AttachmentStorage, "getItem">, project: string): StoredAttachment[] {
  try {
    return parseRecentAttachments(storage.getItem(recentAttachmentKey(project)), project);
  } catch {
    return [];
  }
}

export function saveRecentAttachments(storage: AttachmentStorage, project: string, entries: StoredAttachment[]): void {
  const slice = entries.slice(0, MAX_RECENT).map((entry) => ({
    id: entry.id,
    project: entry.project,
    filename: entry.filename,
    status: entry.status,
    createdAt: entry.createdAt,
  }));
  try {
    if (slice.length === 0) storage.removeItem(recentAttachmentKey(project));
    else storage.setItem(recentAttachmentKey(project), JSON.stringify(slice));
  } catch {
    // 存储被禁用或已满时只失去最近记录，不阻断上传、查询等主流程。
  }
}

export function rememberAttachment(storage: AttachmentStorage, item: StoredAttachment, items: StoredAttachment[]): StoredAttachment[] {
  const next = [item, ...items.filter((entry) => entry.id !== item.id)].slice(0, MAX_RECENT);
  saveRecentAttachments(storage, item.project, next);
  return next;
}
