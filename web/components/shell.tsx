import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppHeader } from "@/components/app/app-header";
import { AppMobileFooter } from "@/components/app/app-mobile-footer";
import { AppMobileHeader } from "@/components/app/app-mobile-header";
import { AppSidebar } from "@/components/app/app-sidebar";
import { ListItem, ListItemContent, ListItemHeader } from "@/components/list-item";
import { Card, CardFrame, CardFrameHeader, CardPanel } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

function RouteSkeleton() {
  const { t } = useTranslation();

  return (
    <div aria-busy="true" aria-live="polite" className="flex min-h-0 min-w-0 flex-1 flex-col" role="status">
      <span className="sr-only">{t("common.loading")}</span>
      <AppHeader>
        <div className="flex flex-col gap-1">
          <Skeleton aria-hidden="true" className="h-4.5 w-36" />
          <Skeleton aria-hidden="true" className="h-5 w-64 max-md:hidden" />
        </div>
      </AppHeader>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CardFrame className="min-h-0 flex-1">
          <CardFrameHeader>
            <Skeleton aria-hidden="true" className="h-5 w-40" />
            <Skeleton aria-hidden="true" className="h-5 w-56 max-w-full" />
          </CardFrameHeader>
          <Card className="min-h-0 flex-1">
            <CardPanel className="p-0">
              {Array.from({ length: 5 }, (_, index) => (
                <ListItem key={index}>
                  <ListItemContent>
                    <ListItemHeader>
                      <Skeleton aria-hidden="true" className="h-5 w-full max-w-48" />
                      <Skeleton aria-hidden="true" className="h-4 w-full max-w-32" />
                    </ListItemHeader>
                  </ListItemContent>
                  <Skeleton aria-hidden="true" className="size-8 rounded-lg" />
                </ListItem>
              ))}
            </CardPanel>
          </Card>
        </CardFrame>
      </div>
    </div>
  );
}

export function AppShell() {
  return (
    <SidebarProvider>
      <AppMobileHeader />
      <AppSidebar />
      <SidebarInset className="max-md:pt-[calc(3.5rem+env(safe-area-inset-top))] max-md:[&>div]:pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <Suspense fallback={<RouteSkeleton />}>
          <Outlet />
        </Suspense>
      </SidebarInset>
      <AppMobileFooter />
    </SidebarProvider>
  );
}
