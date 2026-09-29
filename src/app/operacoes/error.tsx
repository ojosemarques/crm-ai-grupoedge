"use client";

import { Button } from "@/components/ui/button";

export default function OperationsError({ reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <main className="page-canvas"><section className="rounded-[var(--radius-panel)] border border-red-200 bg-red-50 p-6" role="alert"><p className="eyebrow text-red-700">Falha controlada</p><h1 className="mt-2 text-xl font-semibold">Não foi possível carregar o console operacional</h1><p className="mt-2 text-sm text-muted-foreground">Nenhum dado foi alterado. Tente novamente ou consulte o identificador nos logs locais.</p><Button className="mt-4" onClick={reset}>Tentar novamente</Button></section></main>;
}
