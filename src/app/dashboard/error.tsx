"use client";

import { PageError } from "@/components/ui/page-error";

export default function DashboardError({ error, retry }: Readonly<{ error: Error & { digest?: string }; retry: () => void }>) {
  return <PageError description="A consulta falhou de forma controlada. Os filtros continuam na URL." error={error} retry={retry} title="Não foi possível carregar o dashboard" />;
}
