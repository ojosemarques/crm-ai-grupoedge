import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getFinanceService } from "@/modules/finance/application/finance-service";
import type { CompensationFilters } from "@/modules/finance/domain/finance-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Period = { from?: string | undefined; to?: string | undefined };
type Paging = { page: number; pageSize: number };
export const financeListSections = [
  "lancamentos", "entradas", "despesas", "pagar-receber", "cobrancas", "contas",
  "categorias", "centros-custo", "recorrencias", "extratos", "conciliacao",
  "comprovantes", "comissoes", "regras-comissao", "remuneracao",
] as const;
type FinanceListSection = typeof financeListSections[number];

export async function readCrmMcpFinanceReport(
  context: AuthenticatedContext,
  { report, accountId, ...period }: Period & { report: "dashboard" | "fluxo-caixa" | "dre"; accountId?: string | undefined },
) {
  const view = report === "dashboard" ? { dashboard: true } : report === "fluxo-caixa" ? { accountId } : undefined;
  const screen = await getFinanceService().screen(context, period, view);
  if (accountId && screen.cashFlowReport?.accountId !== accountId) {
    throw new ApplicationError("Conta financeira não encontrada para o relatório.", { code: "FINANCE_ACCOUNT_NOT_FOUND", statusCode: 404, expose: true });
  }
  const meta = { period: screen.period, timeZone: screen.timeZone, report };
  if (report === "fluxo-caixa") {
    return { ...meta, cashFlow: screen.cashFlowReport, projection: screen.cashProjection, projectionPeriod: screen.projectionPeriod, projectionScope: "WORKSPACE" };
  }
  const summary = Object.fromEntries(Object.entries(screen.summary).filter(([key]) =>
    screen.permissions.commissionsManage || !key.startsWith("commission")));
  if (report === "dre") return { ...meta, summary, lines: screen.dre };
  return { ...meta, summary, dashboard: screen.dashboard };
}

export async function readCrmMcpFinanceList(
  context: AuthenticatedContext,
  { section, page, pageSize, recordId, compensation, ...period }: Period & Paging & {
    section: FinanceListSection; recordId?: string | undefined; compensation?: CompensationFilters | undefined;
  },
) {
  const finance = getFinanceService();
  if (section === "extratos" || section === "conciliacao" || section === "comprovantes") {
    const rows = await finance.listSupportingRecords(context, { section, page, pageSize, recordId, ...period });
    return { section, ...period, page, pageSize, hasMore: rows.length > pageSize, items: rows.slice(0, pageSize) };
  }

  if (section === "comissoes" || section === "regras-comissao" || section === "remuneracao") {
    await getAuthorizationService().assertAuthorized(context, PermissionKeys.FINANCE_COMMISSIONS, {
      workspaceId: context.workspaceId, resourceType: "Finance",
    });
  }
  const screen = await finance.screen(context, { ...period, compensation }, section === "lancamentos" ? { entries: true } : undefined);
  const entries: readonly Record<string, unknown>[] = screen.entries;
  const rowsBySection = {
    lancamentos: entries,
    entradas: entries.filter((row) => row.direction === "INCOME" && row.reportingKind !== "BALANCE_ONLY" && row.reportingKind !== "EXPENSE_REFUND"),
    despesas: entries.filter((row) => row.direction === "EXPENSE" && row.reportingKind !== "BALANCE_ONLY"),
    "pagar-receber": entries.filter((row) => ["PLANNED", "OPEN", "PENDING", "PARTIALLY_PAID", "OVERDUE", "DUE"].includes(String(row.status))),
    cobrancas: screen.receivables,
    contas: screen.accounts,
    categorias: screen.categories,
    "centros-custo": screen.costCenters,
    recorrencias: screen.recurrences,
    comissoes: screen.commissions,
    "regras-comissao": screen.commissionRules,
    remuneracao: screen.compensation,
  };
  const rows = rowsBySection[section];
  const start = (page - 1) * pageSize;
  return {
    section, period: screen.period, timeZone: screen.timeZone, page, pageSize,
    total: rows.length, hasMore: start + pageSize < rows.length, items: rows.slice(start, start + pageSize),
  };
}
