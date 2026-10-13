/*
 * Vendored from Coss UI registry at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: apps/ui/registry/default/ui/spinner.tsx
 * Upstream license: MIT (apps/ui exception in Coss LICENSING.md)
 * Modified: 2026-08-20
 * Local modifications: updated imports to local alias paths; removed unused exports.
 */
import { Loader2Icon } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof Loader2Icon>): React.ReactElement {
  return (
    <Loader2Icon
      aria-label="Loading"
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}
