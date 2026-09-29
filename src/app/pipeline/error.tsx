"use client";

import { PageError } from "@/components/ui/page-error";

export default function PipelineError({ error, retry }: Readonly<{ error: Error & { digest?: string }; retry: () => void }>) {
  return <PageError description="Tente novamente. Se o erro continuar, confira a configuração das oito etapas." error={error} retry={retry} title="Não foi possível carregar o pipeline" />;
}
