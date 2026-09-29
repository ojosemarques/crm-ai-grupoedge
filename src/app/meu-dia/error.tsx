"use client";

import { PageError } from "@/components/ui/page-error";

export default function MyDayError({ error, retry }: Readonly<{ error: Error & { digest?: string }; retry: () => void }>) {
  return <PageError description="Nenhuma contagem aproximada foi exibida. Tente consultar os dados persistidos novamente." error={error} retry={retry} title="Não foi possível carregar sua fila" />;
}
