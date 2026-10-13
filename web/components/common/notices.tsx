import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useApp } from "../../context/app-context";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";

// Portal to body so the stack escapes #root's `isolation: isolate` and stays above dialogs.
export function NoticeStack() {
  const { t } = useTranslation();
  const { notices, dismissNotice } = useApp();
  const icons = { success: CheckCircle2, error: TriangleAlert, info: Info };
  return createPortal(
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-100 ms-auto grid max-w-sm gap-2" aria-live="polite">
      {notices.map((notice) => {
        const Icon = icons[notice.kind];
        return (
          <Alert className="pointer-events-auto" key={notice.id} role={notice.kind === "error" ? "alert" : "status"} variant={notice.kind}>
            <Icon aria-hidden="true" />
            <AlertDescription>{notice.message}</AlertDescription>
            <AlertAction>
              <Button aria-label={t("common.closeNotification")} onClick={() => dismissNotice(notice.id)} size="icon-sm" variant="ghost">
                <X aria-hidden="true" />
              </Button>
            </AlertAction>
          </Alert>
        );
      })}
    </div>,
    document.body,
  );
}
