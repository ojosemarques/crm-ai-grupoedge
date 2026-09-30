"use client";

import { PageError } from "@/components/ui/page-error";

export default function ErrorPage({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) { return <PageError title="Não foi possível carregar as atividades" description="Nenhuma tarefa foi alterada. Tente consultar a fila novamente." error={error} retry={reset} />; }
