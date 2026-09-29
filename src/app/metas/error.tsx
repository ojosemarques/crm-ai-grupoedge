"use client";
import { Button } from "@/components/ui/button";
export default function GoalsError({ reset }: Readonly<{ error: Error; reset: () => void }>) { return <main className="page-canvas"><div className="feedback feedback-error" role="alert"><strong>Não foi possível carregar as metas.</strong><p>Tente novamente; nenhum dado foi alterado.</p><Button className="mt-3" onClick={reset} variant="secondary">Tentar novamente</Button></div></main>; }
