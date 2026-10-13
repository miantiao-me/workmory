/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: components/settings/settings-sidebar.tsx
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: replaced next/link back navigation with an onClose callback and i18n labels.
 */
"use client";

import { ArrowLeftIcon } from "lucide-react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { SettingsNavContent } from "@/components/settings/settings-nav-section";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

export function SettingsSidebar({
  onClose,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const backLabel = t("common.back");

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <div className="flex flex-col gap-1 px-2 lg:px-1">
          <SidebarMenuButton
            aria-label={backLabel}
            onClick={onClose}
            tooltip={backLabel}
          >
            <ArrowLeftIcon aria-hidden="true" />
            <span className="max-lg:sr-only">{backLabel}</span>
          </SidebarMenuButton>
          <div className="max-md:hidden lg:hidden">
            <SettingsDrawer />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-0 max-lg:hidden">
        <SettingsNavContent />
      </SidebarContent>
    </Sidebar>
  );
}
