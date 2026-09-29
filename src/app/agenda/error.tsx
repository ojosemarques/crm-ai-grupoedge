"use client";

import { PageError } from "@/components/ui/page-error";

export default function AgendaError({ error, retry }: Readonly<{ error: Error & { digest?: string }; retry: () => void }>) {
  return <PageError description="O erro foi controlado. Tente consultar novamente sem perder os filtros da URL." error={error} retry={retry} title="Não foi possível carregar a agenda" />;
}
