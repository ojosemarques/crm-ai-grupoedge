import { CommercialGoals } from "@/components/finance/commercial-goals";
import { redirect } from "next/navigation";
import { z } from "zod";

import { FinanceWorkspace, type FinanceScreenView, type FinanceSection, type CashFlowFilters } from "@/app/financeiro/finance-workspace";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getFinanceService } from "@/modules/finance/application/finance-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { getDatabaseClient } from "@/shared/core/database/client";
import { addLocalDays, workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";

export const dynamic = "force-dynamic";

const sections = new Set<FinanceSection>(["dashboard", "lancamentos", "entradas", "despesas", "fluxo-caixa", "dre", "contas", "pagar-receber", "conciliacao", "recorrencias", "centros-custo", "comprovantes", "comissoes", "metricas-metas", "categorias"]);

function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export default async function FinancePage({ searchParams }: Readonly<{ searchParams: Promise<{ section?: string; month?: string; year?: string; from?: string; to?: string; account?: string }> }>) {
  const context = await requirePageAuthentication();
  const query = await searchParams;
  const now = new Date();
  const workspace = await getDatabaseClient().workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
  const today = workspaceDateAt(now, workspace.timeZone);
  const [currentYear, currentMonth] = today.split("-").map(Number);
  const section = sections.has(query.section as FinanceSection) ? query.section as FinanceSection : "dashboard";
  const month = integer(query.month, currentMonth!, 1, 12);
  const year = integer(query.year, currentYear!, 2000, section === "metricas-metas" ? 2099 : 2200);
  const monthStart = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  let from = workspaceDayRange(monthStart, workspace.timeZone).start;
  let to = workspaceDayRange(nextMonth, workspace.timeZone).start;
  let cashFlowFilters: CashFlowFilters | null = null;
  let screen: Awaited<ReturnType<ReturnType<typeof getFinanceService>["screen"]>>;
  let goals: Awaited<ReturnType<ReturnType<typeof getFinanceService>["goals"]>> | null = null;
  try {
    const finance = getFinanceService();
    if (section === "fluxo-caixa") {
      const dates = await finance.statementMovementDates(context, workspaceDayRange(today, workspace.timeZone).end);
      const last = dates.to ? workspaceDateAt(dates.to, workspace.timeZone) : null;
      const first = dates.from ? workspaceDateAt(dates.from, workspace.timeZone) : null;
      const statementPeriod = first && last ? { from: first, to: last } : null;
      const firstSelectableDay = statementPeriod ? addLocalDays(statementPeriod.to, -364) : null;
      const statementFilter = statementPeriod && firstSelectableDay && statementPeriod.from < firstSelectableDay
        ? { ...statementPeriod, from: firstSelectableDay }
        : statementPeriod;
      const defaultFrom = monthStart <= today ? monthStart : today.slice(0, 7) + "-01";
      const monthEnd = addLocalDays(nextMonth, -1);
      const monthly = { from: defaultFrom, to: monthEnd < today ? monthEnd : today };
      const custom = query.from !== undefined || query.to !== undefined;
      const fromInput = z.iso.date().safeParse(query.from);
      const toInput = z.iso.date().safeParse(query.to);
      const valid = fromInput.success && toInput.success && fromInput.data >= "2000-01-01"
        && fromInput.data <= toInput.data && toInput.data <= today && fromInput.data >= addLocalDays(toInput.data, -364);
      const fallback = (query.month === undefined && query.year === undefined ? statementFilter : null) ?? monthly;
      const period = valid ? { from: fromInput.data, to: toInput.data } : fallback;
      from = workspaceDayRange(period.from, workspace.timeZone).start;
      to = workspaceDayRange(period.to, workspace.timeZone).end;
      cashFlowFilters = { ...period, today, statementFilter, invalidPeriod: (custom && !valid) || (!custom && monthStart > today) };
    }
    screen = await finance.screen(context, { from, to }, cashFlowFilters ? { accountId: query.account } : undefined);
    if (section === "metricas-metas") goals = await finance.goals(context, `${year}-${String(month).padStart(2, "0")}`);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  const goalTimeZone = goals?.timeZone ?? workspace.timeZone;
  return <main className="page-canvas page-canvas-wide"><FinanceWorkspace initialScreen={screen as FinanceScreenView} month={month} section={section} year={year} cashFlowFilters={cashFlowFilters}
    goals={goals && <section aria-labelledby="finance-goals-title">
      <h2 id="finance-goals-title">Métricas Metas</h2>
      {goals.people.length ? goals.people.map((person) => <CommercialGoals key={person.memberId} person={person} timeZone={goalTimeZone} />)
        : <p>{goals.active ? "Nenhum plano coberto nesta competência." : "A política comercial ainda não se aplica nesta competência."}</p>}
    </section>} /></main>;
}
