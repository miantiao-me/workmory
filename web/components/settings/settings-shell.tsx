import { Suspense, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { SettingsMobileHeader } from "@/components/settings/settings-mobile-header";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { Dialog, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { readSettingsBackground } from "@/lib/settings-route";

function SettingsRouteFallback(): ReactElement {
  return (
    <div aria-busy="true" className="grid gap-4 p-6" role="status">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-full max-w-lg" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function SettingsShell(): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const background = readSettingsBackground(location);

  function closeSettings(): void {
    if (background.hasHistoryEntry) navigate(-1);
    else navigate("/", { replace: true });
  }

  return (
    <Dialog onOpenChange={(open) => !open && closeSettings()} open>
      <DialogPopup
        className="h-[80vh] max-h-[80vh] overflow-hidden sm:max-w-4xl"
        closeProps={{
          "aria-label": t("common.close"),
          className: "absolute end-3 top-3 z-20 rounded-md bg-background/80 backdrop-blur-sm max-md:hidden",
        }}
      >
        <DialogTitle className="sr-only">{t("settings.title")}</DialogTitle>
        <SidebarProvider className="h-full min-h-0 overflow-hidden">
          <SettingsMobileHeader onClose={closeSettings} />
          <SettingsSidebar className="absolute inset-y-0 h-full" onClose={closeSettings} />
          <SidebarInset className="min-h-0 overflow-hidden max-md:pt-14 [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col [&>div]:overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl">
              <Suspense fallback={<SettingsRouteFallback />}>
                <Outlet />
              </Suspense>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </DialogPopup>
    </Dialog>
  );
}
