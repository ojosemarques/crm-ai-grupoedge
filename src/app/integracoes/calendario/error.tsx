"use client";

import { PageError } from "@/components/ui/page-error";

export default function ErrorPage({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) { return <PageError title="Não foi possível carregar o calendário local" description="Nenhum evento foi sincronizado. Tente novamente." error={error} retry={reset} />; }
