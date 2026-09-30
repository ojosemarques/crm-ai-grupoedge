import { redirect } from "next/navigation";

import { FinanceWorkspace, type FinanceScreenView, type FinanceSection } from "@/app/financeiro/finance-workspace";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getFinanceService } from "@/modules/finance/application/finance-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";

export const dynamic = "force-dynamic";

const sections = new Set<FinanceSection>(["dashboard", "lancamentos", "entradas", "despesas", "fluxo-caixa", "dre", "contas", "pagar-receber", "comissoes", "categorias"]);

function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export default async function FinancePage({ searchParams }: Readonly<{ searchParams: Promise<{ section?: string; month?: string; year?: string }> }>) {
  const context = await requirePageAuthentication();
  const query = await searchParams;
  const now = new Date();
  const section = sections.has(query.section as FinanceSection) ? query.section as FinanceSection : "dashboard";
  const month = integer(query.month, now.getMonth() + 1, 1, 12);
  const year = integer(query.year, now.getFullYear(), 2000, 2200);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  let screen: unknown;
  try {
    screen = await getFinanceService().screen(context, { from, to });
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide"><FinanceWorkspace initialScreen={screen as FinanceScreenView} month={month} section={section} year={year} /></main>;
}
