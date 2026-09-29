"use client";
import { PageError } from "@/components/ui/page-error";
export default function ErrorState({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) { return <PageError error={error} title="Não foi possível carregar o sandbox n8n" description="Nenhum dado externo foi enviado. Tente consultar novamente." retry={reset} />; }
