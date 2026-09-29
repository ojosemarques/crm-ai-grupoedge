"use client";

import { PageError } from "@/components/ui/page-error";

export default function PrivacyError({
  error,
  retry,
}: Readonly<{ error: Error & { digest?: string }; retry: () => void }>) {
  return (
    <PageError
      description="A consulta falhou de forma controlada. Nenhuma decisão de privacidade foi alterada."
      error={error}
      retry={retry}
      title="Não foi possível carregar privacidade e retenção"
    />
  );
}
