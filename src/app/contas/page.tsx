import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountListWorkspace } from "@/app/contas/account-list-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { DataTableShell } from "@/components/ui/surface";
import { getAccountService } from "@/modules/accounts/application/account-service";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const saleStatusLabels = {
  ALL: "Todas as vendas",
  TO_CONFIRM: "A confirmar",
  AWAITING_RECEIPT: "Aguardando primeiro recebimento",
  CONFIRMED: "Clientes confirmados",
};

export default async function AccountsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const context = await requirePageAuthentication();
  const params = await searchParams;
  if (first(params.view) !== "empresas") {
    const search = first(params.search)?.slice(0, 200) ?? "";
    const requestedStatus = first(params.status);
    const status = requestedStatus && Object.hasOwn(saleStatusLabels, requestedStatus) ? requestedStatus : "ALL";
    const requestedPage = Number(first(params.page));
    const page = Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 10_000 ? requestedPage : 1;
    let sales: Awaited<ReturnType<ReturnType<typeof getOpportunityService>["listCustomerSales"]>>;
    try {
      sales = await getOpportunityService().listCustomerSales(context, { search, status, page });
    } catch (error) {
      if (error instanceof AccessDeniedError) redirect("/contas?view=empresas");
      throw error;
    }
    const pageHref = (next: number) => `/contas?${new URLSearchParams({ search, status, page: String(next) })}`;
    return <main className="page-canvas page-canvas-wide">
      <PageHeader eyebrow="Receita B2B" title="Clientes e empresas" description="Acompanhe vendas ganhas, confirmações e o primeiro recebimento." meta={`${sales.total} vendas`} />
      <nav aria-label="Clientes e empresas" className="mb-4 flex gap-3">
        <Link aria-current="page" href="/contas">Clientes</Link>
        <Link href="/contas?view=empresas">Cadastro de empresas</Link>
      </nav>
      <form action="/contas" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1">Buscar
          <input className="h-10 rounded-md border bg-card px-3" name="search" defaultValue={search} placeholder="Empresa ou venda" maxLength={200} />
        </label>
        <label className="grid gap-1">Situação
          <select className="h-10 rounded-md border bg-card px-3" name="status" defaultValue={status}>
            {Object.entries(saleStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <Button type="submit" variant="secondary">Filtrar</Button>
      </form>
      {sales.items.length ? <DataTableShell><table className="w-full text-left">
        <thead><tr><th scope="col">Empresa</th><th scope="col">Venda</th><th scope="col">Vendedor</th><th scope="col">Situação</th></tr></thead>
        <tbody>{sales.items.map((sale) => <tr key={sale.id}>
          <td><Link href={`/contas/${sale.account.id}`}>{sale.account.name}</Link></td>
          <td><Link href={`/contas/${sale.account.id}/vendas/${sale.id}`}>{sale.name}</Link></td><td>{sale.sellerName}</td><td>{saleStatusLabels[sale.status]}</td>
        </tr>)}</tbody>
      </table></DataTableShell> : <p>Nenhuma venda encontrada para este filtro.</p>}
      <nav aria-label="Paginação de clientes" className="mt-4 flex gap-3">
        {page > 1 ? <Link href={pageHref(page - 1)}>Anterior</Link> : null}
        {page * sales.pageSize < sales.total ? <Link href={pageHref(page + 1)}>Próxima</Link> : null}
      </nav>
    </main>;
  }
  let result: Awaited<ReturnType<ReturnType<typeof getAccountService>["list"]>>;
  let openReviews = 0;
  try {
    result = await getAccountService().list(context, { search: first(params.search), status: first(params.status), segment: first(params.segment), size: first(params.size), quality: first(params.quality), page: first(params.page), pageSize: first(params.pageSize) });
    try { openReviews = (await getAccountService().listReviews(context)).length; } catch { /* leitura opcional conforme RBAC */ }
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide"><PageHeader eyebrow="Receita B2B" title="Empresas" description="Organize empresas, contatos e relacionamentos comerciais." meta={`${result.total} contas · ${openReviews} revisões abertas`} /><Link href="/contas">Clientes</Link><AccountListWorkspace initial={result} /></main>;
}
