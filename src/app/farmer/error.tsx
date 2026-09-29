"use client";
import { Button } from "@/components/ui/button";
export default function Error({reset}:{reset:()=>void}){return <main className="page-canvas"><section className="feedback feedback-error" role="alert"><h1 className="font-semibold">Falha ao carregar</h1><p>Não foi possível carregar a carteira Farmer.</p><Button className="mt-3" onClick={reset}>Tentar novamente</Button></section></main>;}
