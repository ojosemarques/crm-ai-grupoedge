"use client";
import { Button } from "@/components/ui/button";
export default function PaymentsError({reset}:{reset:()=>void}){return <main className="page-canvas"><section className="surface-panel" role="alert"><h1>Não foi possível carregar pagamentos</h1><p>Os dados persistidos não foram alterados. Tente novamente.</p><Button onClick={reset}>Tentar novamente</Button></section></main>}
