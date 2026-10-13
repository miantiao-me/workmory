import { useCallback, useEffect, useRef, useState } from "react";
import type { MemoryRecord } from "../../server/domain/memory";
import { useApp } from "../context/app-context";
import { errorMessage, RequestGeneration } from "../lib/presentation";

interface RetrieveOptions {
  // 记录缺失时需要展示错误的调用方传入工厂，抛出后走统一 catch（提示 + 关闭对话框）
  missingError?: () => Error;
}

// 记忆详情对话框的加载生命周期：代际 token + 可选 scope 检查，保证过期请求不回写。
// scopeKey 变化即视为过期（页面 scope 切换时调用方也会同步 invalidate）。
export function useMemoryDetail({ scopeKey, onError }: {
  scopeKey?: string;
  onError?: (message: string) => void;
} = {}) {
  const { api, handleApiError } = useApp();
  const [detail, setDetail] = useState<MemoryRecord>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const requests = useRef(new RequestGeneration());
  const activeScope = useRef(scopeKey);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    activeScope.current = scopeKey;
  }, [scopeKey]);

  const close = useCallback(() => {
    requests.current.invalidate();
    setDetail(undefined);
    setLoading(false);
    setOpen(false);
  }, []);

  const retrieve = useCallback(async (
    request: { project: string; namespace: string; key: string },
    options?: RetrieveOptions,
  ): Promise<MemoryRecord | undefined> => {
    const requestScope = activeScope.current;
    const token = requests.current.issue();
    const isCurrent = () => requests.current.isCurrent(token)
      && (scopeKey === undefined || activeScope.current === requestScope);
    setDetail(undefined);
    setOpen(true);
    setLoading(true);
    try {
      const result = await api.memoryRetrieve(request);
      if (!isCurrent()) return undefined;
      if (!result.record) {
        if (options?.missingError) throw options.missingError();
        setOpen(false);
        return undefined;
      }
      setDetail(result.record);
      return result.record;
    } catch (cause) {
      if (!isCurrent()) return undefined;
      handleApiError(cause);
      onErrorRef.current?.(errorMessage(cause));
      setOpen(false);
      return undefined;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [api, handleApiError, scopeKey]);

  const setDialogOpen = useCallback((next: boolean) => {
    if (next) setOpen(true);
    else close();
  }, [close]);

  useEffect(() => () => requests.current.invalidate(), []);

  return { detail, open, loading, close, retrieve, setDetail, setDialogOpen };
}
