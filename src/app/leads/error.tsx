"use client";

import { PageError } from "@/components/ui/page-error";

export default function LeadsError({ error, retry }: Readonly<{ error: Error & { digest?: string }; retry: () => void }>) {
  return <PageError description="Os filtros foram preservados na URL. Tente consultar os dados novamente." error={error} retry={retry} title="Não foi possível carregar os leads" />;
}
