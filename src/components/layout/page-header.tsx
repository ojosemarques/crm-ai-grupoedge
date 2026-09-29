import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
  back,
  actions,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  meta?: string;
  back?: Readonly<{ href: string; label: string }>;
  actions?: ReactNode;
}>) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        {back ? <Link className="page-header__back" href={back.href}>← {back.label}</Link> : null}
        <p className="page-header__eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-header__description">{description}</p>
      </div>
      {meta || actions ? <div className="page-header__aside">{meta ? <p>{meta}</p> : null}{actions}</div> : null}
    </header>
  );
}
