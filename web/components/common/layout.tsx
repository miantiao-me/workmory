import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function DetailList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 sm:gap-y-4", className)} data-slot="detail-list">{children}</dl>;
}

export function DetailItem({ label, value, mono = false, className }: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)} data-slot="detail-item">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 break-words font-medium text-foreground", mono && "font-mono text-xs font-normal")}>{value}</dd>
    </div>
  );
}
