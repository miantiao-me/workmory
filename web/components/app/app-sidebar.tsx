/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: components/app/app-sidebar.tsx
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: replaced Cal.com header/footer content with Workmory navigation, project overview, and i18n labels; updated imports to local alias paths.
 */
"use client";

import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/app/logo";
import { NavMain } from "@/components/app/nav-main";
import { NavSecondary } from "@/components/app/nav-secondary";
import { ProjectOverview } from "@/components/app/project-overview";
import {
  navMainItems,
  navSecondaryItems,
} from "@/components/app/navigation-data";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

export function AppSidebar({
  variant,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  variant?: never;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <div className="flex flex-col items-center justify-between gap-0.5 px-1 lg:flex-row">
          <SidebarMenuButton
            className="w-fit justify-center md:max-lg:p-0"
            render={<Logo />}
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMainItems} />
        <SidebarGroup className="mt-auto hidden lg:flex">
          <SidebarGroupContent>
            <ProjectOverview />
          </SidebarGroupContent>
        </SidebarGroup>
        <NavSecondary items={navSecondaryItems} />
      </SidebarContent>
    </Sidebar>
  );
}
