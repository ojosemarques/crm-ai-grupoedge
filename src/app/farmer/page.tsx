import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getFarmerService } from "@/modules/farmer/application/farmer-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { FarmerWorkspace, type FarmerScreenView } from "./farmer-workspace";
export const dynamic="force-dynamic";
export default async function FarmerPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const context=await requirePageAuthentication();const raw=await searchParams;const query=Object.fromEntries(Object.entries(raw).filter((entry):entry is[string,string]=>typeof entry[1]==="string"));let screen;try{screen=await getFarmerService().screen(context,query);}catch(error){if(error instanceof AccessDeniedError)redirect("/acesso-negado");throw error;}return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Receita pós-venda" title="Farmer" description="Renovações, expansão e decisões de receita com confirmação humana e histórico rastreável." meta={`${context.displayName} · ${screen.timeZone}`}/><FarmerWorkspace screen={screen as FarmerScreenView}/></main>;}
