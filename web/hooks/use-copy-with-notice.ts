import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useCopyToClipboard } from "usehooks-ts";
import { useApp } from "../context/app-context";

// 复制成功后统一发通知：成功用调用方文案，失败用通用错误
export function useCopyWithNotice() {
  const { t } = useTranslation();
  const { notify } = useApp();
  const [, copy] = useCopyToClipboard();

  return useCallback((value: string, successMessage: string) => {
    void copy(value).then((copied) => {
      if (copied) notify(successMessage, "info");
      else notify(t("common.copyFailed"), "error");
    });
  }, [copy, notify, t]);
}
