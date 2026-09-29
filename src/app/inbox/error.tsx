"use client";

import { PageError } from "@/components/ui/page-error";

export default function InboxError({ error, reset }: Readonly<{ error: Error; reset: () => void }>) {
  return <PageError title="Não foi possível carregar o inbox" description="Nenhuma mensagem foi alterada. Tente novamente." error={error} retry={reset} />;
}
