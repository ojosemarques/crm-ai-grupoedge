import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/shared/core/ui/class-names";

type SurfaceTone = "default" | "subtle" | "accent" | "critical";

export function Surface({
  className,
  tone = "default",
  ...props
}: HTMLAttributes<HTMLElement> & Readonly<{ tone?: SurfaceTone }>) {
  return <section className={cn("surface-panel", `surface-panel--${tone}`, className)} {...props} />;
}

export function SectionHeader({
  title,
  description,
  eyebrow,
  action,
  titleId,
  className,
}: Readonly<{
  title: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
  titleId?: string;
  className?: string;
}>) {
  return (
    <header className={cn("section-header", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="section-header__eyebrow">{eyebrow}</p> : null}
        <h2 id={titleId}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="section-header__action">{action}</div> : null}
    </header>
  );
}

type StatTone = "default" | "info" | "success" | "warning" | "danger";

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  compactValue = false,
  className,
}: Readonly<{
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: StatTone;
  compactValue?: boolean;
  className?: string;
}>) {
  return (
    <div className={cn("stat-card", className)} data-compact-value={compactValue || undefined} data-tone={tone}>
      <p className="stat-card__label">{label}</p>
      <p className="stat-card__value">{value}</p>
      {hint ? <p className="stat-card__hint">{hint}</p> : null}
    </div>
  );
}

export function DataTableShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("data-table-shell", className)} {...props} />;
}
