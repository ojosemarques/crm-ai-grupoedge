import { redirect } from "next/navigation";

import { AccountListWorkspace } from "@/app/contas/account-list-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { getAccountService } from "@/modules/accounts/application/account-service";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function AccountsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  let result: Awaited<ReturnType<ReturnType<typeof getAccountService>["list"]>>;
  let openReviews = 0;
  try {
    result = await getAccountService().list(context, { search: first(params.search), status: first(params.status), segment: first(params.segment), size: first(params.size), quality: first(params.quality), page: first(params.page), pageSize: first(params.pageSize) });
    try { openReviews = (await getAccountService().listReviews(context)).length; } catch { /* leitura opcional conforme RBAC */ }
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Receita B2B" title="Contas" description="Organizações canônicas, pessoas, oportunidades e comitês de compra do workspace." meta={`${result.total} contas · ${openReviews} revisões abertas`} /><AccountListWorkspace initial={result} /></main>;
}
