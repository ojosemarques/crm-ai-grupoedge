"use client";

import { PageError } from "@/components/ui/page-error";

export default function InstagramError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) { return <PageError title="Não foi possível carregar o Instagram" description="Nenhum evento foi registrado. Tente novamente." error={error} retry={reset} />; }
