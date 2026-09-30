"use client";

import { PageError } from "@/components/ui/page-error";

export default function ErrorPage({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <PageError description="Nenhum agente ou estado de conversa foi alterado." error={error} retry={reset} title="Não foi possível carregar os agentes" />;
}
