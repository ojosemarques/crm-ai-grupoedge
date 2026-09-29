"use client";

import { PageError } from "@/components/ui/page-error";

export default function NotificationsError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <PageError description="A consulta falhou de forma controlada. Nenhuma notificação foi alterada." error={error} retry={reset} title="Não foi possível carregar as notificações" />;
}
