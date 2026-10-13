/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: components/app/app-mobile-header.tsx
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: removed header actions, added safe-area padding, updated imports to local alias paths.
 */
import type * as React from "react";
import { Logo } from "@/components/app/logo";
import { MobileHeader } from "@/components/mobile-header";

export function AppMobileHeader(): React.ReactElement {
  return (
    <MobileHeader className="h-[calc(3.5rem+env(safe-area-inset-top))] ps-[max(1rem,env(safe-area-inset-left))] pe-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)]">
      <Logo />
    </MobileHeader>
  );
}
