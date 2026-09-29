"use client";

import { PageError } from "@/components/ui/page-error";

export default function LeadHistoryError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <PageError description="Nenhum dado foi alterado. Tente consultar o registro novamente." error={error} retry={reset} title="Não foi possível carregar o Lead 360" />;
}
