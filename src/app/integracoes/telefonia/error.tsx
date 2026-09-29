"use client";

import { PageError } from "@/components/ui/page-error";

export default function TelephonyError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) { return <PageError title="Não foi possível carregar a telefonia local" description="Nenhuma chamada foi iniciada. Tente novamente." error={error} retry={reset} />; }
