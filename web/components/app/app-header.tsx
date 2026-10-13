/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: components/app/app-header.tsx
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: updated imports to local alias paths.
 */
import type * as React from "react";
import { cn } from "@/lib/utils";

export function AppHeader({
  className,
  ...props
}: React.ComponentProps<"header">): React.ReactElement {
  return (
    <header
      className={cn("mb-6 flex items-start justify-between gap-4", className)}
      {...props}
    />
  );
}

export function AppHeaderContent({
  children,
  className,
  title,
  ...props
}: React.ComponentProps<"div"> & { title: string }): React.ReactElement {
  return (
    <div className={cn("flex flex-col gap-1", className)} {...props}>
      <h1 className="font-bold font-heading text-lg leading-none [font-variation-settings:'GEOM'_50,'opsz'_32]">
        {title}
      </h1>
      {children}
    </div>
  );
}

export function AppHeaderDescription({
  className,
  ...props
}: React.ComponentProps<"p">): React.ReactElement {
  return (
    <p
      className={cn("text-muted-foreground text-sm max-md:hidden", className)}
      {...props}
    />
  );
}

export function AppHeaderActions({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div className={cn("flex items-center gap-2", className)} {...props} />
  );
}
