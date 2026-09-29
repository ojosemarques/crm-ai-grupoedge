"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: Readonly<{ reset: () => void }>) { return <main className="page-canvas"><section className="feedback feedback-error" role="alert"><h1 className="font-semibold">Não foi possível carregar Customer Success</h1><p className="mt-1 text-sm">Os dados persistidos não foram alterados. Tente novamente.</p><Button className="mt-4" onClick={reset}>Tentar novamente</Button></section></main>; }
