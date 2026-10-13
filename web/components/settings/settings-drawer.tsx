/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: components/settings/settings-drawer.tsx
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: updated imports to local alias paths and added i18n labels.
 */
"use client";

import { MenuIcon } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { SettingsNavContent } from "@/components/settings/settings-nav-section";
import {
  Drawer,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { SidebarMenuButton } from "@/components/ui/sidebar";

export function SettingsDrawer(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const { t } = useTranslation();
  const label = t("settings.title");

  const handleCloseDrawer = React.useCallback((): void => {
    setOpen(false);
  }, []);

  return (
    <Drawer onOpenChange={setOpen} open={open} position="left">
      <SidebarMenuButton
        aria-label={label}
        render={<DrawerTrigger />}
        tooltip={label}
      >
        <MenuIcon aria-hidden="true" />
      </SidebarMenuButton>
      <DrawerPopup showCloseButton variant="straight">
        <DrawerHeader className="sr-only">
          <DrawerTitle>{label}</DrawerTitle>
        </DrawerHeader>
        <DrawerPanel className="px-2 pt-4!">
          <SettingsNavContent onItemClick={handleCloseDrawer} />
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  );
}
