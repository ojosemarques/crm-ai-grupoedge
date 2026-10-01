import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMarketingAttributionService } from "@/modules/marketing/application/marketing-attribution-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { AcquisitionWorkspace } from "@/app/aquisicao/acquisition-workspace";

export const dynamic = "force-dynamic";

export default async function AcquisitionPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const context = await requirePageAuthentication();
  const raw = await searchParams;
  const query = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  let screen;
  try {
    screen = await getMarketingAttributionService().getScreen(context, query);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide analytics-canvas">
    <PageHeader eyebrow="Revenue OS" title="Aquisição e atribuição" description="Acompanhe a jornada completa da campanha e do criativo até a venda e o recebimento." />
    <AcquisitionWorkspace initial={screen} />
  </main>;
}
