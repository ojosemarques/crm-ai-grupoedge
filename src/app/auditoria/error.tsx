"use client";

import { PageError } from "@/components/ui/page-error";

export default function AuditError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <PageError description="A consulta falhou de forma controlada. Nenhuma alteração foi feita." error={error} retry={reset} title="Não foi possível carregar a auditoria" />;
}
