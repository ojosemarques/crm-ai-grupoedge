import type { ReactNode } from "react";

import { cn } from "@/shared/core/ui/class-names";

export type StatusTone = "info" | "success" | "warning" | "danger" | "neutral";

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: Readonly<{ children: ReactNode; tone?: StatusTone; className?: string }>) {
  return (
    <span className={cn("status-badge", className)} data-tone={tone}>
      <span aria-hidden="true" className="status-badge__dot" />
      {children}
    </span>
  );
}
