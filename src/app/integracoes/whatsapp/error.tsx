"use client";

import { PageError } from "@/components/ui/page-error";

export default function Error({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) { return <PageError error={error} retry={reset} title="Não foi possível carregar o WhatsApp" description="Revise a conexão local, o banco e as permissões antes de tentar novamente." />; }
