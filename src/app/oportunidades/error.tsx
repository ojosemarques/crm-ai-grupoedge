"use client";

import { PageError } from "@/components/ui/page-error";

export default function OpportunitiesError({ error, retry }: Readonly<{ error: Error & { digest?: string }; retry: () => void }>) {
  return <PageError description="A consulta falhou de forma controlada. Tente novamente sem perder os filtros da URL." error={error} retry={retry} title="Não foi possível carregar o pipeline de vendas" />;
}
