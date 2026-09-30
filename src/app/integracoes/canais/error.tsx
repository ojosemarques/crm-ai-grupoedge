"use client";
import { PageError } from "@/components/ui/page-error";
export default function Error({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) { return <PageError title="Não foi possível carregar a matriz" description="Tente novamente sem alterar o estado das integrações." error={error} retry={reset} />; }
