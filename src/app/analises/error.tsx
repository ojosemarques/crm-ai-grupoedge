"use client";
import { PageError } from "@/components/ui/page-error";
export default function ErrorPage({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) { return <PageError description="Não foi possível abrir os dashboards salvos." error={error} retry={reset} title="Falha ao carregar análises" />; }
