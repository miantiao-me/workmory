/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: components/app/nav-secondary.tsx
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: ported to react-router NavLink with active-state detection and i18n labels; uses local navigation item type.
 */
"use client";

import type * as React from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router-dom";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  isNavigationItemActive,
  type NavigationItem,
} from "@/components/app/navigation-data";

export function NavSecondary({
  items,
  ...props
}: {
  items: NavigationItem[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>): React.ReactElement {
  const location = useLocation();
  const { pathname } = location;
  const { t } = useTranslation();

  return (
    <SidebarGroup {...props}>
      <SidebarMenu
        aria-label={t("shell.groups.utility")}
        className="gap-0.5"
      >
        {items.map((item) => (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton
              isActive={isNavigationItemActive(pathname, item)}
              render={
                <NavLink
                  end={item.end}
                  state={item.to === "/settings" ? { backgroundLocation: location } : undefined}
                  to={item.to}
                />
              }
              tooltip={t(item.labelKey)}
            >
              <item.icon aria-hidden="true" />
              <span className="md:max-lg:sr-only lg:inline">
                {t(item.labelKey)}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
