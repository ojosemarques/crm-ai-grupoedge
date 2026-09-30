import { redirect } from "next/navigation";

import { FinanceWorkspace, type FinanceScreenView, type FinanceSection } from "@/app/financeiro/finance-workspace";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getFinanceService } from "@/modules/finance/application/finance-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { getDatabaseClient } from "@/shared/core/database/client";
import { workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";

export const dynamic = "force-dynamic";

const sections = new Set<FinanceSection>(["dashboard", "lancamentos", "entradas", "despesas", "fluxo-caixa", "dre", "contas", "pagar-receber", "conciliacao", "recorrencias", "centros-custo", "comprovantes", "comissoes", "categorias"]);

function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export default async function FinancePage({ searchParams }: Readonly<{ searchParams: Promise<{ section?: string; month?: string; year?: string }> }>) {
  const context = await requirePageAuthentication();
  const query = await searchParams;
  const now = new Date();
  const workspace = await getDatabaseClient().workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
  const [currentYear, currentMonth] = workspaceDateAt(now, workspace.timeZone).split("-").map(Number);
  const section = sections.has(query.section as FinanceSection) ? query.section as FinanceSection : "dashboard";
  const month = integer(query.month, currentMonth!, 1, 12);
  const year = integer(query.year, currentYear!, 2000, 2200);
  const from = workspaceDayRange(new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10), workspace.timeZone).start;
  const to = workspaceDayRange(new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10), workspace.timeZone).start;
  let screen: unknown;
  try {
    screen = await getFinanceService().screen(context, { from, to });
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  return <main className="page-canvas page-canvas-wide"><FinanceWorkspace initialScreen={screen as FinanceScreenView} month={month} section={section} year={year} /></main>;
}
