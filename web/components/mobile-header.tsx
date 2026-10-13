/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: components/mobile-header.tsx
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: updated imports to local alias paths.
 */
"use client";

import type * as React from "react";
import { useScrollHide } from "@/hooks/use-scroll-hide";
import { cn } from "@/lib/utils";

export function MobileHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const isHidden = useScrollHide();

  return (
    <header
      className={cn(
        "fixed top-0 z-50 flex h-14 w-full items-center justify-between border-border border-b bg-sidebar px-4 transition-transform duration-500 ease-in-out md:hidden",
        isHidden ? "-translate-y-full" : "translate-y-0",
        className,
      )}
    >
      {children}
    </header>
  );
}
