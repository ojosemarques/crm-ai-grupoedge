import { redirect } from "next/navigation";
import { CustomerServiceWorkspace, type CustomerServiceDetailView, type CustomerServiceScreenView } from "@/app/customer-service/customer-service-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getCustomerServiceService } from "@/modules/customer-service/application/customer-service-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";
export default async function CustomerServicePage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication(); const raw = await searchParams; const requestId = typeof raw.requestId === "string" ? raw.requestId : undefined; const query = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => entry[0] !== "requestId" && typeof entry[1] === "string"));
  let screen;
  let detail;
  try {
    const service = getCustomerServiceService(); [screen, detail] = await Promise.all([service.screen(context, query), requestId ? service.detail(context, requestId) : Promise.resolve(null)]);
  } catch (error) { if (error instanceof AccessDeniedError) redirect("/acesso-negado"); throw error; }
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Pós-venda" title="Atendimento ao cliente" description="Acompanhe solicitações, prazos de atendimento e a satisfação dos clientes." meta={`${context.displayName} · ${screen.timeZone}`} /><CustomerServiceWorkspace detail={JSON.parse(JSON.stringify(detail)) as CustomerServiceDetailView | null} screen={JSON.parse(JSON.stringify(screen)) as CustomerServiceScreenView} /></main>;
}
