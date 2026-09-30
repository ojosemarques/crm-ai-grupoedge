"use client";

import { PageError } from "@/components/ui/page-error";

export default function ErrorPage({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <PageError description="Nenhuma consulta ou proposta foi alterada." error={error} retry={reset} title="Não foi possível carregar o assistente" />;
}
