/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: components/settings/settings-mobile-header.tsx
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: replaced next/link back navigation with an onClose callback, added className prop and i18n labels.
 */
import { ArrowLeftIcon } from "lucide-react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { MobileHeader } from "@/components/mobile-header";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SettingsMobileHeaderProps {
  className?: string;
  onClose: () => void;
}

export function SettingsMobileHeader({
  className,
  onClose,
}: SettingsMobileHeaderProps): React.ReactElement {
  const { t } = useTranslation();
  const backLabel = t("common.back");

  return (
    <MobileHeader className={cn(className)}>
      <Button
        aria-label={backLabel}
        onClick={onClose}
        variant="ghost"
      >
        <ArrowLeftIcon className="-ms-0.5" />
        <span>{backLabel}</span>
      </Button>
      <SettingsDrawer />
    </MobileHeader>
  );
}
