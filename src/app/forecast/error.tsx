"use client";

import { PageError } from "@/components/ui/page-error";

export default function ForecastError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <PageError
      description="Os cortes persistidos permanecem intactos. Tente novamente."
      error={error}
      retry={reset}
      title="Não foi possível carregar o forecast"
    />
  );
}
