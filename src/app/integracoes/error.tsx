"use client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
export default function ErrorPage({ reset }: Readonly<{ reset: () => void }>) { return <main className="page-canvas"><EmptyState title="Não foi possível carregar as integrações" description="A conexão local ou a permissão pode estar indisponível." action={<Button onClick={reset}>Tentar novamente</Button>} /></main>; }
