import { redirect } from "next/navigation";

import { ContractsWorkspace } from "@/app/contratos/contracts-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getContractService } from "@/modules/contracts/application/contract-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function ContractsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  let screen;
  try {
    screen = await getContractService().getScreen(context, { search: first(params.search) ?? "", status: first(params.status) ?? "ALL" });
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Receita contratada" title="Contratos comerciais" description="Organize seus contratos, acompanhe os aceites e as próximas renovações." meta={`${context.displayName} · ${screen.timeZone}`} /><ContractsWorkspace screen={screen} /></main>;
}
