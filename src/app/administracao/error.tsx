"use client";

import { PageError } from "@/components/ui/page-error";

export default function AdministrationError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <PageError description="Nenhuma alteração foi aplicada. Tente consultar os dados do workspace novamente." error={error} retry={reset} title="Não foi possível carregar a administração" />;
}
