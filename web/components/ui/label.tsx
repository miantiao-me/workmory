/*
 * Vendored from Coss UI registry at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: apps/ui/registry/default/ui/label.tsx
 * Upstream license: MIT (apps/ui exception in Coss LICENSING.md)
 * Modified: 2026-08-20
 * Local modifications: updated imports to local alias paths; removed unused exports.
 */
"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type React from "react";
import { cn } from "@/lib/utils";

export function Label({
  className,
  render,
  ...props
}: useRender.ComponentProps<"label">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "inline-flex items-center gap-2 font-medium text-base/4.5 text-foreground sm:text-sm/4",
      className,
    ),
    "data-slot": "label",
  };

  return useRender({
    defaultTagName: "label",
    props: mergeProps<"label">(defaultProps, props),
    render,
  });
}
