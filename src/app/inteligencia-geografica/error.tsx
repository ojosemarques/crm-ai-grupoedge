"use client";
import { PageError } from "@/components/ui/page-error";
export default function GeographicError({error,reset}:Readonly<{error:Error&{digest?:string};reset:()=>void}>){return <PageError error={error} retry={reset} title="Não foi possível carregar a inteligência geográfica" description="A consulta foi interrompida sem expor localização ou dados pessoais."/>;}
