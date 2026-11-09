import { CommercialGoals } from "@/components/finance/commercial-goals";
import { redirect } from "next/navigation";

import { FinanceWorkspace, type FinanceScreenView, type FinanceSection } from "@/app/financeiro/finance-workspace";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getFinanceService } from "@/modules/finance/application/finance-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { getDatabaseClient } from "@/shared/core/database/client";
import { workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";

export const dynamic = "force-dynamic";

const sections = new Set<FinanceSection>(["dashboard", "lancamentos", "entradas", "despesas", "fluxo-caixa", "dre", "contas", "pagar-receber", "conciliacao", "recorrencias", "centros-custo", "comprovantes", "comissoes", "metricas-metas", "categorias"]);

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
  const year = integer(query.year, currentYear!, 2000, section === "metricas-metas" ? 2099 : 2200);
  const from = workspaceDayRange(new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10), workspace.timeZone).start;
  const to = workspaceDayRange(new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10), workspace.timeZone).start;
  let screen: Awaited<ReturnType<ReturnType<typeof getFinanceService>["screen"]>>;
  let goals: Awaited<ReturnType<ReturnType<typeof getFinanceService>["goals"]>> | null = null;
  try {
    const finance = getFinanceService();
    screen = await finance.screen(context, { from, to });
    if (section === "metricas-metas") goals = await finance.goals(context, `${year}-${String(month).padStart(2, "0")}`);
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    throw error;
  }
  const goalTimeZone = goals?.timeZone ?? workspace.timeZone;
  return <main className="page-canvas page-canvas-wide"><FinanceWorkspace initialScreen={screen as FinanceScreenView} month={month} section={section} year={year}
    goals={goals && <section aria-labelledby="finance-goals-title">
      <h2 id="finance-goals-title">Métricas Metas</h2>
      {goals.people.length ? goals.people.map((person) => <CommercialGoals key={person.memberId} person={person} timeZone={goalTimeZone} />)
        : <p>{goals.active ? "Nenhum plano coberto nesta competência." : "A política comercial ainda não se aplica nesta competência."}</p>}
    </section>} /></main>;
}
