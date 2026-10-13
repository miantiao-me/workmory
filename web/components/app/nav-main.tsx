/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: components/app/nav-main.tsx
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: heavily simplified — removed collapsible submenus and collapsed-sidebar menus, ported to react-router with i18n labels.
 */
"use client";

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

export function NavMain({
  items,
}: {
  items: NavigationItem[];
}): React.ReactElement {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  return (
    <SidebarGroup>
      <SidebarMenu aria-label={t("shell.primaryNavigation")} className="gap-0.5">
        {items.map((item) => (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton
              isActive={isNavigationItemActive(pathname, item)}
              render={<NavLink end={item.end} to={item.to} />}
              tooltip={t(item.labelKey)}
            >
              <item.icon aria-hidden="true" />
              <span className="max-lg:sr-only">{t(item.labelKey)}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
