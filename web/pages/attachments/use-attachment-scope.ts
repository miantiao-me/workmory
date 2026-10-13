import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useApp } from "../../context/app-context";
import type { AttachmentMetadata } from "../../lib/api/types";
import { downloadBlob, errorMessage, idempotencyKeyFromInput, RequestGeneration, stableIdentifier, UserFacingError } from "../../lib/presentation";
import { loadRecentAttachments, rememberAttachment, saveRecentAttachments, type StoredAttachment } from "../../lib/recent-attachments";

export type RecentAttachmentItem = AttachmentMetadata | StoredAttachment;
export type AttachmentPending = "upload" | "query" | "original" | "markdown" | "delete";

export function isCompleteMetadata(item: RecentAttachmentItem): item is AttachmentMetadata {
  return "detectedMime" in item;
}

const MAX_BYTES = 8 * 1024 * 1024;
const ATTACHMENT_ID_PATTERN = /^att_[a-f0-9]{32}$/;

// 附件页全部服务端交互集中于此。scope 安全规则：project 变化时 effect 统一
// invalidate 在途请求并清理 pending/error/selection，之后旧请求的任何回写
// 都会被 isCurrent(token) 拒绝；下载/删除等操作同样走这一代际检查。
export function useAttachmentScope() {
  const { api, defaultProject, handleApiError, notify, refreshProjectDirectory } = useApp();
  const { t } = useTranslation();
  const [project, setProject] = useState(defaultProject);
  const [items, setItems] = useState<RecentAttachmentItem[]>(() => loadRecentAttachments(window.localStorage, defaultProject));
  const [selected, setSelected] = useState<AttachmentMetadata>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [attachmentId, setAttachmentId] = useState("");
  const [pending, setPending] = useState<AttachmentPending | null>(null);
  const [error, setError] = useState("");
  const requests = useRef(new RequestGeneration());
  const busy = pending !== null;

  // 外部默认值变化时同步页面 scope（等价于用户切换 project）
  useEffect(() => {
    setProject(defaultProject);
  }, [defaultProject]);

  // scope 切换统一清理：在途请求失效、pending/error/selection/详情全部复位
  useEffect(() => {
    requests.current.invalidate();
    setPending(null);
    setError("");
    setSelected(undefined);
    setDetailOpen(false);
    setItems(loadRecentAttachments(window.localStorage, project));
  }, [project]);

  useEffect(() => () => requests.current.invalidate(), []);

  const remember = useCallback((item: AttachmentMetadata) => {
    setItems((current) => rememberAttachment(window.localStorage, item, current));
  }, []);

  const showError = useCallback((cause: unknown, token: number) => {
    if (!requests.current.isCurrent(token)) return;
    handleApiError(cause);
    setError(errorMessage(cause));
  }, [handleApiError]);

  const endPending = useCallback((token: number) => {
    if (requests.current.isCurrent(token)) setPending(null);
  }, []);

  // 内部统一的元数据获取入口；返回 undefined 表示请求已过期
  const retrieveAttachment = useCallback(async (projectValue: string, id: string, token: number): Promise<AttachmentMetadata | undefined> => {
    const result = await api.getAttachment(projectValue, id);
    return requests.current.isCurrent(token) ? result : undefined;
  }, [api]);

  const upload = useCallback(async (event: FormEvent, file: File | undefined, idempotencyKey: string) => {
    event.preventDefault();
    setError("");
    if (pending) return;
    if (!file) { setError(t("attachments.validation.selectFile")); return; }
    if (file.size > MAX_BYTES) { setError(t("attachments.validation.size")); return; }
    const token = requests.current.issue();
    try {
      const validatedProject = stableIdentifier(project, t("common.fields.project"), 128);
      const validatedKey = idempotencyKeyFromInput(idempotencyKey);
      if (new TextEncoder().encode(file.name.normalize("NFC")).byteLength > 255) throw new UserFacingError(t("attachments.validation.filename"));
      setPending("upload");
      const result = await api.uploadAttachment({ project: validatedProject, file, filename: file.name, idempotencyKey: validatedKey });
      if (!requests.current.isCurrent(token)) return;
      setSelected(result);
      setDetailOpen(true);
      setAttachmentId(result.id);
      setProject(result.project);
      remember(result);
      void refreshProjectDirectory();
      notify(result.reused ? t("attachments.notifications.reused") : t("attachments.notifications.uploaded"));
    } catch (cause) {
      showError(cause, token);
    } finally {
      endPending(token);
    }
  }, [api, endPending, notify, pending, project, remember, refreshProjectDirectory, showError, t]);

  const query = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    setError("");
    if (pending) return;
    const token = requests.current.issue();
    try {
      const validatedProject = stableIdentifier(project, t("common.fields.project"), 128);
      const validatedId = attachmentId.trim();
      if (!ATTACHMENT_ID_PATTERN.test(validatedId)) throw new UserFacingError(t("attachments.validation.attachmentId"));
      setPending("query");
      const result = await retrieveAttachment(validatedProject, validatedId, token);
      if (!result) return;
      setSelected(result);
      setDetailOpen(true);
      remember(result);
    } catch (cause) {
      showError(cause, token);
    } finally {
      endPending(token);
    }
  }, [attachmentId, endPending, pending, project, remember, retrieveAttachment, showError, t]);

  const download = useCallback(async (kind: "original" | "markdown") => {
    if (!selected || pending) return;
    const token = requests.current.issue();
    setPending(kind);
    setError("");
    try {
      const blob = await api.downloadAttachment(selected.project, selected.id, kind);
      if (!requests.current.isCurrent(token)) return;
      const name = kind === "markdown" ? `${selected.filename.replace(/\.[^.]+$/, "")}.md` : selected.filename;
      downloadBlob(blob, name);
      notify(kind === "markdown" ? t("attachments.notifications.markdownDownload") : t("attachments.notifications.originalDownload"), "info");
    } catch (cause) {
      showError(cause, token);
    } finally {
      endPending(token);
    }
  }, [api, endPending, notify, pending, selected, showError, t]);

  const remove = useCallback(async () => {
    if (!selected || pending) return;
    const deleted = selected;
    const token = requests.current.issue();
    setPending("delete");
    setError("");
    try {
      await api.deleteAttachment(deleted.project, deleted.id);
      // 目标附件属于其自身 project 的缓存；无论当前 scope 是否仍指向它都更新持久化记录
      saveRecentAttachments(
        window.localStorage,
        deleted.project,
        loadRecentAttachments(window.localStorage, deleted.project).filter((item) => item.id !== deleted.id),
      );
      setItems((current) => current.filter((item) => item.id !== deleted.id));
      if (!requests.current.isCurrent(token)) return;
      setSelected(undefined);
      setDetailOpen(false);
      setAttachmentId("");
      notify(t("attachments.notifications.deleting"));
    } catch (cause) {
      showError(cause, token);
    } finally {
      endPending(token);
    }
  }, [api, endPending, notify, pending, selected, showError, t]);

  const selectItem = useCallback((item: RecentAttachmentItem) => {
    setError("");
    setAttachmentId(item.id);
    if (isCompleteMetadata(item)) {
      setSelected(item);
      setDetailOpen(true);
      setProject(item.project);
      return;
    }
    // 本地恢复的记录只有列表字段：先取服务端最新元数据，再打开详情并刷新持久化记录。
    if (pending) return;
    const token = requests.current.issue();
    setPending("query");
    void (async () => {
      try {
        const result = await retrieveAttachment(item.project, item.id, token);
        if (!result) return;
        setSelected(result);
        setDetailOpen(true);
        setProject(result.project);
        remember(result);
      } catch (cause) {
        showError(cause, token);
      } finally {
        endPending(token);
      }
    })();
  }, [endPending, pending, remember, retrieveAttachment, showError]);

  const setDetailDialogOpen = useCallback((open: boolean) => {
    setDetailOpen(open);
    if (!open) setError("");
  }, []);

  return {
    project,
    setProject,
    items,
    selected,
    detailOpen,
    setDetailDialogOpen,
    attachmentId,
    setAttachmentId,
    pending,
    busy,
    error,
    upload,
    query,
    download,
    remove,
    selectItem,
  };
}
