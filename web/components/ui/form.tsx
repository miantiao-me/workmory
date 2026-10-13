/*
 * Vendored from Coss UI registry at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: apps/ui/registry/default/ui/form.tsx
 * Upstream license: MIT (apps/ui exception in Coss LICENSING.md)
 * Modified: 2026-08-20
 * Local modifications: updated imports to local alias paths; removed unused exports.
 */
"use client";

import { Form as FormPrimitive } from "@base-ui/react/form";
import type React from "react";

export function Form({
  className,
  ...props
}: FormPrimitive.Props): React.ReactElement {
  return <FormPrimitive className={className} data-slot="form" {...props} />;
}

export { FormPrimitive };
