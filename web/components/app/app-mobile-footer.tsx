/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: components/app/app-mobile-footer.tsx
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: ported to react-router NavLink, Workmory navigation items and i18n labels, safe-area padding, project overview in the "more" menu.
 */
"use client";

import { EllipsisIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router-dom";
import { ProjectOverview } from "@/components/app/project-overview";
import {
  isNavigationItemActive,
  navMainItems,
  navSecondaryItems,
  type NavigationItem,
} from "@/components/app/navigation-data";
import {
  AdaptiveMenu,
  AdaptiveMenuGroup,
  AdaptiveMenuItem,
  AdaptiveMenuPopup,
  AdaptiveMenuSeparator,
  AdaptiveMenuTrigger,
} from "@/components/shared/adaptive-menu";
import { Button } from "@/components/ui/button";
import { useScrollHide } from "@/hooks/use-scroll-hide";
import { cn } from "@/lib/utils";

const primaryNavItems: NavigationItem[] = navMainItems.slice(0, 3);
const remainingMainItems: NavigationItem[] = navMainItems.slice(3);

export function AppMobileFooter(): React.ReactElement {
  const location = useLocation();
  const { pathname } = location;
  const { t } = useTranslation();
  const isHidden = useScrollHide();
  const moreItems = [...remainingMainItems, ...navSecondaryItems];
  const isMoreActive = moreItems.some((item) =>
    isNavigationItemActive(pathname, item),
  );

  return (
    <footer
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-2 ps-[max(0.75rem,env(safe-area-inset-left))] pe-[max(0.75rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] transition-transform duration-500 ease-in-out before:pointer-events-none before:absolute before:inset-x-0 before:-bottom-1 before:h-[200%] before:bg-linear-to-t before:from-60% before:from-background before:transition-opacity before:duration-500 before:ease-in-out md:hidden",
        isHidden
          ? "translate-y-full before:opacity-0"
          : "translate-y-0 before:opacity-100",
      )}
    >
      <nav
        aria-label={t("shell.mobilePrimaryNavigation")}
        className="relative flex w-fit items-center justify-around gap-1 rounded-full border bg-popover p-1 shadow-black/5 shadow-lg backdrop-blur-sm before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
      >
        {primaryNavItems.map((item) => (
          <NavLink
            aria-label={t(item.labelKey)}
            className="flex size-11 items-center justify-center rounded-full text-sidebar-foreground/80 aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground"
            end={item.end}
            key={item.to}
            to={item.to}
          >
            <item.icon aria-hidden="true" className="size-5" />
          </NavLink>
        ))}
        <AdaptiveMenu>
          <AdaptiveMenuTrigger
            aria-label={t("shell.mobileNavigation.more")}
            render={
              <Button
                aria-current={isMoreActive ? "page" : undefined}
                className="size-11! rounded-full text-sidebar-foreground/80 aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground"
                variant="ghost"
              />
            }
          >
            <EllipsisIcon aria-hidden="true" className="size-5" />
          </AdaptiveMenuTrigger>
          <AdaptiveMenuPopup title={t("shell.mobileNavigation.more")}>
            <AdaptiveMenuGroup>
              {remainingMainItems.map((item) => (
                <AdaptiveMenuItem
                  key={item.to}
                  render={
                    <NavLink
                      end={item.end}
                      state={item.to === "/settings" ? { backgroundLocation: location } : undefined}
                      to={item.to}
                    />
                  }
                >
                  <item.icon aria-hidden="true" />
                  <span>{t(item.labelKey)}</span>
                </AdaptiveMenuItem>
              ))}
            </AdaptiveMenuGroup>
            <AdaptiveMenuSeparator />
            <AdaptiveMenuGroup>
              {navSecondaryItems.map((item) => (
                <AdaptiveMenuItem
                  key={item.to}
                  render={
                    <NavLink
                      end={item.end}
                      state={
                        item.to === "/settings"
                          ? { backgroundLocation: location }
                          : undefined
                      }
                      to={item.to}
                    />
                  }
                >
                  <item.icon aria-hidden="true" />
                  <span>{t(item.labelKey)}</span>
                </AdaptiveMenuItem>
              ))}
            </AdaptiveMenuGroup>
            <AdaptiveMenuSeparator />
            <AdaptiveMenuGroup>
              <ProjectOverview />
            </AdaptiveMenuGroup>
          </AdaptiveMenuPopup>
        </AdaptiveMenu>
      </nav>
    </footer>
  );
}
