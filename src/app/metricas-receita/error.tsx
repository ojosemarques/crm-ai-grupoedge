"use client";
import { PageError } from "@/components/ui/page-error";
export default function RevenueMetricsError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) { return <PageError error={error} title="Não foi possível calcular as métricas" description="Nenhum valor foi estimado. Revise o período ou tente novamente." retry={reset} />; }
