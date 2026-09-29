"use client";

import { PageError } from "@/components/ui/page-error";

export default function ErrorPage({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <PageError description="Nenhuma versão ou execução foi alterada." error={error} retry={reset} title="Não foi possível carregar a governança de IA" />;
}
