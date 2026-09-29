"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export function PageError({
  error,
  retry,
  title,
  description,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
  title: string;
  description: string;
}>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="page-state">
      <section className="page-state__panel page-state__panel--error" role="alert">
        <span aria-hidden="true" className="page-state__symbol">!</span>
        <div><h1>{title}</h1><p>{description}</p></div>
        <Button onClick={retry} type="button">Tentar novamente</Button>
      </section>
    </main>
  );
}
