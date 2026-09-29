"use client";

import { PageError } from "@/components/ui/page-error";

export default function CopilotError({ error, retry }: Readonly<{ error: Error & { digest?: string }; retry: () => void }>) {
  return <PageError description="A falha foi controlada. Tente novamente sem alterar os filtros." error={error} retry={retry} title="Não foi possível carregar o Copilot" />;
}
