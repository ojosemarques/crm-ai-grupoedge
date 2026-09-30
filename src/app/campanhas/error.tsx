"use client";

import { PageError } from "@/components/ui/page-error";

export default function CampaignsError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <PageError error={error} retry={reset} title="Não foi possível carregar as campanhas" description="A fila e os recibos persistidos continuam intactos. Tente novamente." />;
}
