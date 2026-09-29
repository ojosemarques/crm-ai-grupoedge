import type { ReactNode } from "react";

import { cn } from "@/shared/core/ui/class-names";

export function EmptyState({
  title,
  description,
  action,
  compact = false,
  className,
}: Readonly<{
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}>) {
  return (
    <div className={cn("empty-state", compact && "empty-state--compact", className)}>
      <span aria-hidden="true" className="empty-state__mark">P</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
