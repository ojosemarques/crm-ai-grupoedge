"use client";

import { PageError } from "@/components/ui/page-error";

export default function SettingsError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <PageError description="Nenhuma alteração foi aplicada. Tente consultar as políticas novamente." error={error} retry={reset} title="Não foi possível carregar as configurações" />;
}
