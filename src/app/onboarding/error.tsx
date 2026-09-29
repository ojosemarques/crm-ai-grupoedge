"use client";

import { Button } from "@/components/ui/button";

export default function OnboardingError({ reset }: Readonly<{ reset(): void }>) {
  return <main className="page-canvas"><section className="surface-panel p-6" role="alert"><h1 className="text-xl font-semibold">Não foi possível carregar o onboarding</h1><p className="mt-2 text-sm text-muted-foreground">Nenhum dado foi alterado. Tente novamente.</p><Button className="mt-4" onClick={reset}>Tentar novamente</Button></section></main>;
}
