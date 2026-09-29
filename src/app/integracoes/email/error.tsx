"use client";
import { PageError } from "@/components/ui/page-error";
export default function Error({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) { return <PageError title="Não foi possível carregar o canal de e-mail" description="Nenhuma mensagem foi enviada. Tente novamente." error={error} retry={reset} />; }
