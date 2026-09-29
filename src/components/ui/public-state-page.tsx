import Link from "next/link";

import { Button } from "@/components/ui/button";

export function PublicStatePage({
  eyebrow,
  title,
  description,
  action,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  action: Readonly<{ href: string; label: string }>;
}>) {
  return (
    <main className="public-state">
      <section className="public-state__panel">
        <div aria-hidden="true" className="public-state__brand">P</div>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="public-state__description">{description}</p>
          <Button asChild className="mt-7"><Link href={action.href}>{action.label}</Link></Button>
        </div>
      </section>
    </main>
  );
}
