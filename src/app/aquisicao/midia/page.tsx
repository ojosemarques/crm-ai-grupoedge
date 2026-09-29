import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMediaPerformanceService } from "@/modules/marketing/application/media-performance-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { MediaPerformanceWorkspace } from "@/app/aquisicao/midia/media-performance-workspace";

export const dynamic="force-dynamic";
export default async function MediaPerformancePage(){const context=await requirePageAuthentication();let screen;try{screen=await getMediaPerformanceService().getScreen(context);}catch(error){if(error instanceof AccessDeniedError)redirect("/acesso-negado");throw error;}return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Revenue OS · Aquisição" title="Mídia paga e performance" description="Custos, funil e reconciliação a partir de importações locais. Nenhuma plataforma externa está conectada."/><MediaPerformanceWorkspace initial={screen}/></main>;}
