"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function GoogleAdsError({ reset }: Readonly<{ reset: () => void }>) {
  return <main className="page-canvas"><EmptyState title="Não foi possível carregar a conexão Google Ads" description="A conexão local, o banco ou a permissão pode estar indisponível." action={<Button onClick={reset}>Tentar novamente</Button>} /></main>;
}
