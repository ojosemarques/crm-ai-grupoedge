import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  commissionAmountCents,
  createCommissionRuleSchema,
  createFinancialAccountSchema,
  createFinancialCategorySchema,
  createFinancialEntrySchema,
  financeCommandSchema,
  financeQuerySchema,
  financialAttachmentMetadataSchema,
  nextCommissionStatus,
  reconcileCommissionsSchema,
  settleFinancialEntrySchema,
  updateCommissionSchema,
  createCostCenterSchema,
  createRecurrenceSchema,
  importBankStatementSchema,
  reviewBankLineSchema,
  reviewExpenseSchema,
} from "@/modules/finance/domain/finance-contracts";
import { PAYMENT_PROVIDER_KEY } from "@/modules/payments/domain/payment-contracts";
import { buildDre, dailyCashFlow, type CashMovement } from "@/modules/finance/domain/finance-reporting";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";

type Authorization = ReturnType<typeof getAuthorizationService>;
type Options = Readonly<{ database: PrismaClient; authorization: Authorization; now: () => Date }>;
type Transaction = Prisma.TransactionClient;

const resource = (workspaceId: string, resourceId?: string, memberId?: string | null) => ({
  workspaceId,
  resourceType: "Finance",
  ...(resourceId ? { resourceId } : {}),
  ...(memberId ? { memberId } : {}),
});
function fail(message: string, code = "INVALID_FINANCE_OPERATION", statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}
const iso = (value: Date | null) => value?.toISOString() ?? null;
const money = (value: bigint) => value.toString();
function addMonths(value: Date, months: number) { const next = new Date(value); const day = next.getUTCDate(); next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + months); const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate(); next.setUTCDate(Math.min(day, last)); return next; }
function splitCsvLine(line: string, separator: string) {
  const values: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === separator && !quoted) { values.push(value.trim()); value = ""; }
    else value += character;
  }
  if (quoted) fail("O extrato possui aspas não fechadas.", "FINANCE_STATEMENT_CSV", 400);
  values.push(value.trim()); return values;
}
function parseStatementCsv(csv: string) {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) fail("O extrato precisa ter cabeçalho e ao menos uma movimentação.", "FINANCE_STATEMENT_EMPTY", 400);
  const separator = lines[0]!.includes(";") ? ";" : ",";
  const headers = splitCsvLine(lines[0]!, separator).map((item) => item.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const dateIndex = headers.findIndex((item) => ["data", "date", "occurredat"].includes(item));
  const descriptionIndex = headers.findIndex((item) => ["descricao", "historico", "description"].includes(item));
  const amountIndex = headers.findIndex((item) => ["valor", "amount"].includes(item));
  if ([dateIndex, descriptionIndex, amountIndex].some((index) => index < 0)) fail("Use as colunas data, descrição e valor no extrato CSV.", "FINANCE_STATEMENT_COLUMNS", 400);
  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line, separator);
    const dateValue = values[dateIndex]!; const [a, b, c] = dateValue.split(/[\/-]/).map(Number);
    const occurredAt = /^\d{4}/.test(dateValue) ? new Date(`${dateValue}T12:00:00.000Z`) : new Date(Date.UTC(c!, b! - 1, a!, 12));
    const numeric = values[amountIndex]!.replace(/\s|R\$/gi, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
    const amount = Number(numeric);
    if (Number.isNaN(occurredAt.getTime()) || !Number.isFinite(amount) || amount === 0 || !values[descriptionIndex]) fail(`Linha ${index + 2} do extrato é inválida.`, "FINANCE_STATEMENT_ROW", 400);
    const amountCents = BigInt(Math.round(amount * 100));
    return { occurredAt, description: values[descriptionIndex]!, amountCents, rawData: { line: index + 2, values } as Prisma.InputJsonValue };
  });
}

function defaultPeriod(now: Date, timeZone: string) {
  const [year, month] = workspaceDateAt(now, timeZone).split("-").map(Number);
  const fromDate = new Date(Date.UTC(year!, month! - 1, 1)).toISOString().slice(0, 10);
  const toDate = new Date(Date.UTC(year!, month!, 1)).toISOString().slice(0, 10);
  const from = workspaceDayRange(fromDate, timeZone).start;
  const to = workspaceDayRange(toDate, timeZone).start;
  return { from, to };
}

export async function reconcileCommissionsInTransaction(tx: Transaction, context: AuthenticatedContext, through: Date, opportunityId?: string) {
  const rules = await tx.commissionRule.findMany({
    where: { workspaceId: context.workspaceId, effectiveFrom: { lte: through }, OR: [{ active: true }, { effectiveTo: { not: null } }] },
    orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }],
  });
  let created = 0;
  for (const rule of rules) {
    const opportunities = await tx.opportunity.findMany({
      where: { workspaceId: context.workspaceId, ...(opportunityId ? { id: opportunityId } : {}), ownerMemberId: rule.sellerMemberId, status: "WON", closedAt: { not: null, gte: rule.effectiveFrom, lte: through, ...(rule.effectiveTo ? { lt: rule.effectiveTo } : {}) }, deletedAt: null },
      select: { id: true, ownerMemberId: true, amountCents: true, mrrCents: true, tcvCents: true, currency: true, closedAt: true },
    });
    for (const opportunity of opportunities) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`commission:${context.workspaceId}:${rule.id}:${opportunity.id}`}, 0))`;
      const contract = await tx.commercialContract.findFirst({
        where: { workspaceId: context.workspaceId, opportunityId: opportunity.id, status: "ACCEPTED" },
        select: { id: true },
      });
      const basisCents = rule.basis === "MRR" ? opportunity.mrrCents : rule.basis === "SALE_AMOUNT" ? opportunity.amountCents : opportunity.tcvCents > 0n ? opportunity.tcvCents : opportunity.amountCents;
      if (rule.trigger === "SALE") {
        const existing = await tx.commission.findFirst({ where: { workspaceId: context.workspaceId, opportunityId: opportunity.id, ruleId: rule.id, paymentId: null }, select: { id: true } });
        if (existing) continue;
        await tx.commission.create({ data: {
          workspaceId: context.workspaceId, ruleId: rule.id, sellerMemberId: rule.sellerMemberId,
          opportunityId: opportunity.id, contractId: contract?.id ?? null, basisCents,
          percentageBps: rule.percentageBps, amountCents: commissionAmountCents(basisCents, rule.percentageBps),
          currency: opportunity.currency, earnedAt: opportunity.closedAt!, idempotencyKey: `finance:commission:${opportunity.id}:${rule.id}`,
          createdByActorId: context.actorId, updatedByActorId: context.actorId,
        } });
        created += 1;
        continue;
      }
      if (!contract || basisCents <= 0n) continue;
      const invoices = await tx.invoice.findMany({ where: { workspaceId: context.workspaceId, contractId: contract.id }, select: { id: true } });
      if (!invoices.length) continue;
      const payments = await tx.payment.findMany({
        where: { workspaceId: context.workspaceId, invoiceId: { in: invoices.map((item) => item.id) }, status: "CONFIRMED", reversedAt: null, occurredAt: { lte: through } },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      });
      const existing = await tx.commission.findMany({ where: { workspaceId: context.workspaceId, opportunityId: opportunity.id, ruleId: rule.id, paymentId: { not: null } }, select: { paymentId: true, basisCents: true } });
      const existingPaymentIds = new Set(existing.map((item) => item.paymentId));
      let remainingCents = basisCents - existing.reduce((sum, item) => sum + item.basisCents, 0n);
      for (const payment of payments) {
        if (existingPaymentIds.has(payment.id) || remainingCents <= 0n) continue;
        const earnedBasisCents = payment.amountCents < remainingCents ? payment.amountCents : remainingCents;
        await tx.commission.create({ data: {
          workspaceId: context.workspaceId, ruleId: rule.id, sellerMemberId: rule.sellerMemberId,
          opportunityId: opportunity.id, contractId: contract.id, paymentId: payment.id, basisCents: earnedBasisCents,
          percentageBps: rule.percentageBps, amountCents: commissionAmountCents(earnedBasisCents, rule.percentageBps),
          currency: payment.currency, earnedAt: payment.occurredAt, idempotencyKey: `finance:commission:${opportunity.id}:${rule.id}:payment:${payment.id}`,
          createdByActorId: context.actorId, updatedByActorId: context.actorId,
        } });
        remainingCents -= earnedBasisCents;
        created += 1;
      }
    }
  }
  return { rules: rules.length, created };
}

export function createFinanceService(options: Options) {
  async function screen(context: AuthenticatedContext, raw: unknown = {}) {
    await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_READ, resource(context.workspaceId));
    const query = financeQuerySchema.parse(raw);
    const workspace = await options.database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
    const fallback = defaultPeriod(options.now(), workspace.timeZone);
    const from = query.from ?? fallback.from;
    const to = query.to ?? fallback.to;
    financeQuerySchema.parse({ from, to });
    const projectionTo = new Date(to.getTime() + 30 * 86_400_000);
    const canManage = (await options.authorization.authorize(context, PermissionKeys.FINANCE_MANAGE, resource(context.workspaceId))).allowed;
    const canManageCommissions = (await options.authorization.authorize(context, PermissionKeys.FINANCE_COMMISSIONS, resource(context.workspaceId))).allowed;
    const [categories, financialAccounts, entries, invoices, payments, subscriptions, movements, opportunities, rules, commissions, members, priorManualBalances, costCenters, recurrences, statementImports, statementLines, attachments] = await Promise.all([
      options.database.financialCategory.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
      options.database.financialAccount.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
      options.database.financialEntry.findMany({ where: { workspaceId: context.workspaceId, OR: [{ competenceAt: { gte: from, lt: to } }, { dueAt: { gte: from, lt: to } }, { settledAt: { gte: from, lt: to } }, { status: "PLANNED" }] }, orderBy: [{ dueAt: "desc" }, { createdAt: "desc" }] }),
      options.database.invoice.findMany({ where: { workspaceId: context.workspaceId, status: { notIn: ["VOIDED", "CANCELLED", "DRAFT"] }, OR: [{ billingPeriodStart: { gte: from, lt: to } }, { status: { in: ["OPEN", "PARTIALLY_PAID"] } }] }, orderBy: [{ dueAt: "asc" }] }),
      options.database.payment.findMany({ where: { workspaceId: context.workspaceId, providerKey: { not: PAYMENT_PROVIDER_KEY }, OR: [{ occurredAt: { lt: to } }, { reversedAt: { lt: to } }] } }),
      options.database.subscription.findMany({ where: { workspaceId: context.workspaceId, status: { in: ["ACTIVE", "CANCELLATION_SCHEDULED"] } } }),
      options.database.revenueMovement.findMany({ where: { workspaceId: context.workspaceId, effectiveAt: { gte: from, lt: to } } }),
      options.database.opportunity.findMany({ where: { workspaceId: context.workspaceId, status: "WON", closedAt: { gte: from, lt: to }, deletedAt: null } }),
      options.database.commissionRule.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ active: "desc" }, { effectiveFrom: "desc" }] }),
      options.database.commission.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ earnedAt: "desc" }] }),
      options.database.workspaceMember.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true, user: { select: { displayName: true } } }, orderBy: { user: { displayName: "asc" } } }),
      options.database.financialEntry.groupBy({ by: ["financialAccountId", "direction"], where: { workspaceId: context.workspaceId, status: "SETTLED", settledAt: { lt: from } }, _sum: { amountCents: true } }),
      options.database.financialCostCenter.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
      options.database.financialRecurrence.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ active: "desc" }, { firstDueAt: "desc" }] }),
      options.database.bankStatementImport.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { createdAt: "desc" }, take: 30 }),
      options.database.bankStatementLine.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ occurredAt: "desc" }, { id: "asc" }], take: 500 }),
      options.database.financialAttachment.findMany({ where: { workspaceId: context.workspaceId }, select: { id: true, financialEntryId: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 500 }),
    ]);

    const receiptEvents = payments.length ? await options.database.paymentEvent.findMany({ where: { workspaceId: context.workspaceId, paymentId: { in: payments.map((item) => item.id) }, type: "PAYMENT_CONFIRMED" }, select: { paymentId: true, safeMetadata: true } }) : [];
    const receiptByPayment = new Map(receiptEvents.flatMap((event) => {
      const data = event.safeMetadata;
      if (!event.paymentId || !data || typeof data !== "object" || Array.isArray(data) || typeof data.financialAccountId !== "string") return [];
      return [[event.paymentId, { financialAccountId: data.financialAccountId, customerAccountId: typeof data.customerAccountId === "string" ? data.customerAccountId : null, customerName: typeof data.customerName === "string" ? data.customerName : null }]] as const;
    }));
    const accountPaymentBalance = (accountId: string) => payments.filter((item) => receiptByPayment.get(item.id)?.financialAccountId === accountId).reduce((sum, item) => sum + (item.occurredAt < to ? item.amountCents : 0n) - (item.reversedAt && item.reversedAt < to ? item.amountCents : 0n), 0n);
    const manualReceived = entries.filter((item) => item.status === "SETTLED" && item.direction === "INCOME" && item.settledAt && item.settledAt >= from && item.settledAt < to).reduce((sum, item) => sum + item.amountCents, 0n);
    const manualExpenses = entries.filter((item) => item.status === "SETTLED" && item.direction === "EXPENSE" && item.settledAt && item.settledAt >= from && item.settledAt < to).reduce((sum, item) => sum + item.amountCents, 0n);
    const paymentReceived = payments.reduce((sum, item) => {
      const confirmed = item.occurredAt >= from && item.occurredAt < to ? item.amountCents : 0n;
      const reversed = item.reversedAt && item.reversedAt >= from && item.reversedAt < to ? item.amountCents : 0n;
      return sum + confirmed - reversed;
    }, 0n);
    const received = manualReceived + paymentReceived;
    const reversals = payments.filter((item) => item.reversedAt && item.reversedAt >= from && item.reversedAt < to).reduce((sum, item) => sum + item.amountCents, 0n);
    const mrr = subscriptions.reduce((sum, item) => sum + item.currentMrrCents, 0n);
    const tcv = opportunities.reduce((sum, item) => sum + (item.tcvCents > 0n ? item.tcvCents : item.amountCents), 0n);
    const memberName = new Map(members.map((item) => [item.id, item.user.displayName]));
    const commissionTotal = (status: "PENDING" | "APPROVED" | "PAID") => commissions.filter((item) => item.status === status).reduce((sum, item) => sum + item.amountCents, 0n);
    const priorManualBalance = (accountId?: string) => priorManualBalances
      .filter((item) => !accountId || item.financialAccountId === accountId)
      .reduce((sum, item) => sum + (item.direction === "INCOME" ? 1n : -1n) * (item._sum.amountCents ?? 0n), 0n);
    const manualBalance = (accountId?: string) => priorManualBalance(accountId) + entries
      .filter((item) => item.status === "SETTLED" && item.settledAt && item.settledAt >= from && item.settledAt < to && (!accountId || item.financialAccountId === accountId))
      .reduce((sum, item) => sum + (item.direction === "INCOME" ? item.amountCents : -item.amountCents), 0n);
    const paymentBalance = payments.reduce((sum, item) => {
      const confirmed = item.occurredAt < to ? item.amountCents : 0n;
      const reversed = item.reversedAt && item.reversedAt < to ? item.amountCents : 0n;
      return sum + confirmed - reversed;
    }, 0n);
    const openingBalance = financialAccounts.reduce((sum, item) => sum + item.openingBalanceCents, 0n);
    const cashBalance = openingBalance + manualBalance() + paymentBalance;
    const categoryName = new Map(categories.map((item) => [item.id, item.name]));
    const normalizedEntries = [
      ...entries.map((item) => ({ id: item.id, type: "MANUAL" as const, sourceLabel: item.recurrenceId ? `Parcela ${item.installmentNumber ?? ""}` : "Lançamento manual", categoryId: item.categoryId, categoryName: categoryName.get(item.categoryId) ?? "Sem categoria", financialAccountId: item.financialAccountId, customerAccountId: item.customerAccountId, costCenterId: item.costCenterId, recurrenceId: item.recurrenceId, approvalStatus: item.approvalStatus, approvalReason: item.approvalReason, customerName: null, direction: item.direction, status: item.status, description: item.description, counterparty: item.counterparty, amountCents: money(item.amountCents), competenceAt: iso(item.competenceAt), dueAt: iso(item.dueAt), settledAt: iso(item.settledAt), revision: item.revision })),
      ...invoices.map((item) => ({ id: `invoice:${item.id}`, type: "INVOICE" as const, sourceLabel: "Cobrança de cliente", categoryId: null, categoryName: "Receita de cliente", financialAccountId: null, customerAccountId: item.accountId, customerName: item.accountNameSnapshot, direction: "INCOME" as const, status: item.status, description: item.descriptionSnapshot, counterparty: item.accountNameSnapshot, amountCents: money(item.totalCents), outstandingCents: money(item.totalCents - item.paidCents), competenceAt: item.billingPeriodStart.toISOString(), dueAt: item.dueAt.toISOString(), settledAt: iso(item.paidAt), revision: item.revision })),
      ...payments.flatMap((item) => {
        const rows: Array<Record<string, unknown>> = [];
        const receipt = receiptByPayment.get(item.id);
        if (item.occurredAt >= from && item.occurredAt < to) rows.push({ id: `payment:${item.id}:confirmed`, type: "PAYMENT", sourceLabel: "Pagamento confirmado", categoryId: null, categoryName: "Receita recebida", financialAccountId: receipt?.financialAccountId ?? null, customerAccountId: receipt?.customerAccountId ?? null, customerName: receipt?.customerName ?? null, direction: "INCOME", status: "SETTLED", description: "Pagamento confirmado de cliente", counterparty: null, amountCents: money(item.amountCents), competenceAt: item.occurredAt.toISOString(), dueAt: item.occurredAt.toISOString(), settledAt: item.occurredAt.toISOString(), revision: 1 });
        if (item.reversedAt && item.reversedAt >= from && item.reversedAt < to) rows.push({ id: `payment:${item.id}:reversed`, type: "PAYMENT_REVERSAL", sourceLabel: item.status === "CHARGEBACK" ? "Chargeback" : "Pagamento estornado", categoryId: null, categoryName: "Estornos", financialAccountId: receipt?.financialAccountId ?? null, customerAccountId: receipt?.customerAccountId ?? null, customerName: receipt?.customerName ?? null, direction: "EXPENSE", status: "SETTLED", description: item.reversalReason ?? "Reversão de pagamento", counterparty: null, amountCents: money(item.amountCents), competenceAt: item.reversedAt.toISOString(), dueAt: item.reversedAt.toISOString(), settledAt: item.reversedAt.toISOString(), revision: 1 });
        return rows;
      }),
    ].sort((left, right) => String(right.dueAt).localeCompare(String(left.dueAt)));
    const cashOpeningBalance = cashBalance - received + manualExpenses;
    const cashMovements: CashMovement[] = [
      ...entries.flatMap((item) => item.status === "SETTLED" && item.settledAt ? [{ at: item.settledAt, direction: item.direction, amountCents: item.amountCents }] : []),
      ...payments.flatMap((item): CashMovement[] => [{ at: item.occurredAt, direction: "INCOME", amountCents: item.amountCents }, ...(item.reversedAt ? [{ at: item.reversedAt, direction: "EXPENSE" as const, amountCents: item.amountCents }] : [])]),
    ];
    const cashFlow = dailyCashFlow(from, to, cashOpeningBalance, cashMovements, workspace.timeZone);
    const projectionMovements: CashMovement[] = [
      ...entries.filter((item) => item.status === "PLANNED" && item.dueAt < projectionTo).map((item) => ({ at: item.dueAt < to ? to : item.dueAt, direction: item.direction, amountCents: item.amountCents })),
      ...invoices.filter((item) => ["OPEN", "PARTIALLY_PAID"].includes(item.status) && item.dueAt < projectionTo).map((item) => ({ at: item.dueAt < to ? to : item.dueAt, direction: "INCOME" as const, amountCents: item.totalCents - item.paidCents })),
    ];
    const cashProjection = dailyCashFlow(to, projectionTo, cashBalance, projectionMovements, workspace.timeZone);
    const categoryGroup = new Map(categories.map((item) => [item.id, item.dreGroup]));
    const statement = buildDre([
      ...invoices.filter((item) => item.billingPeriodStart >= from && item.billingPeriodStart < to).map((item) => ({ categoryId: "crm-revenue", category: "Receita de clientes", group: "receita_bruta", direction: "INCOME" as const, amountCents: item.totalCents })),
      ...entries.filter((item) => item.status !== "CANCELLED" && item.competenceAt >= from && item.competenceAt < to).map((item) => ({ categoryId: item.categoryId, category: categoryName.get(item.categoryId) ?? "Sem categoria", group: categoryGroup.get(item.categoryId) ?? null, direction: item.direction, amountCents: item.amountCents })),
    ]);
    const dre = statement.lines;
    const openManual = (direction: "INCOME" | "EXPENSE") => entries.filter((item) => item.status === "PLANNED" && item.direction === direction).reduce((sum, item) => sum + item.amountCents, 0n);
    const periodCommissions = commissions.filter((item) => item.earnedAt >= from && item.earnedAt < to);
    const summary = {
      openingBalanceCents: money(cashOpeningBalance), closingBalanceCents: money(cashBalance), projectedCashCents: cashProjection.at(-1)?.balanceCents ?? money(cashBalance), unallocatedPaymentBalanceCents: money(paymentBalance - financialAccounts.reduce((sum, account) => sum + accountPaymentBalance(account.id), 0n)), marginPercent: statement.netRevenue > 0n ? `${Number(statement.netIncome * 10_000n / statement.netRevenue) / 100}%` : "—",
      receivedCents: money(received), incomeCents: money(received + reversals), expenseCents: money(manualExpenses + reversals), resultCents: money(received - manualExpenses), cashBalanceCents: money(cashBalance), mrrCents: money(mrr), tcvCents: money(tcv), netRevenueCents: money(statement.netRevenue), grossProfitCents: money(statement.grossProfit), netIncomeCents: money(statement.netIncome), receivableOpenCents: money(openManual("INCOME") + invoices.reduce((sum, item) => sum + item.totalCents - item.paidCents, 0n)), payableOpenCents: money(openManual("EXPENSE")), commissionCents: money(commissions.reduce((sum, item) => sum + item.amountCents, 0n)), commissionGeneratedCents: money(periodCommissions.reduce((sum, item) => sum + item.amountCents, 0n)), commissionPendingCents: money(commissionTotal("PENDING")), commissionApprovedCents: money(commissionTotal("APPROVED")), commissionPaidCents: money(commissionTotal("PAID")), newMrrCents: money(movements.filter((item) => item.type === "NEW").reduce((sum, item) => sum + item.deltaMrrCents, 0n)), churnMrrCents: money(movements.filter((item) => item.type === "CHURN").reduce((sum, item) => sum + -item.deltaMrrCents, 0n)), unmatchedStatementLines: statementLines.filter((item) => item.status === "UNMATCHED").length, pendingExpenseApprovals: entries.filter((item) => item.approvalStatus === "PENDING").length,
    };

    return Object.freeze({
      generatedAt: options.now().toISOString(),
      timeZone: workspace.timeZone,
      period: { from: from.toISOString(), to: to.toISOString() },
      permissions: { canManage, canManageCommissions, manage: canManage, commissionsManage: canManageCommissions },
      summary,
      metrics: summary,
      cashFlow,
      cashProjection,
      projectionPeriod: { from: to.toISOString(), to: projectionTo.toISOString() },
      dre,
      categories: categories.map((item) => ({ id: item.id, key: item.key, name: item.name, kind: item.kind, dreGroup: item.dreGroup, active: item.active })),
      accounts: financialAccounts.map((item) => ({ id: item.id, name: item.name, type: item.type, openingBalanceCents: money(item.openingBalanceCents), balanceCents: money(item.openingBalanceCents + manualBalance(item.id) + accountPaymentBalance(item.id)), active: item.active })),
      entries: normalizedEntries,
      receivables: invoices.map((item) => ({ id: item.id, invoiceNumber: item.invoiceNumber, customerAccountId: item.accountId, customerName: item.accountNameSnapshot, totalCents: money(item.totalCents), paidCents: money(item.paidCents), openCents: money(item.totalCents - item.paidCents), dueAt: item.dueAt.toISOString(), status: item.status })),
      members: members.map((item) => ({ id: item.id, name: item.user.displayName })),
      commissionRules: rules.map((item) => ({ id: item.id, sellerMemberId: item.sellerMemberId, sellerName: memberName.get(item.sellerMemberId) ?? "Membro indisponível", percentageBps: item.percentageBps, basis: item.basis, trigger: item.trigger, active: item.active, effectiveFrom: item.effectiveFrom.toISOString(), effectiveTo: iso(item.effectiveTo) })),
      commissions: commissions.map((item) => ({ id: item.id, ruleId: item.ruleId, sellerMemberId: item.sellerMemberId, sellerName: memberName.get(item.sellerMemberId) ?? "Membro indisponível", opportunityId: item.opportunityId, contractId: item.contractId, paymentId: item.paymentId, status: item.status, basisCents: money(item.basisCents), percentageBps: item.percentageBps, amountCents: money(item.amountCents), earnedAt: item.earnedAt.toISOString(), approvedAt: iso(item.approvedAt), paidAt: iso(item.paidAt), revision: item.revision })),
      costCenters: costCenters.map((item) => ({ id: item.id, key: item.key, name: item.name, active: item.active })),
      recurrences: recurrences.map((item) => ({ id: item.id, categoryId: item.categoryId, financialAccountId: item.financialAccountId, costCenterId: item.costCenterId, direction: item.direction, description: item.description, counterparty: item.counterparty, amountCents: money(item.amountCents), frequency: item.frequency, installmentCount: item.installmentCount, firstDueAt: item.firstDueAt.toISOString(), active: item.active })),
      statementImports: statementImports.map((item) => ({ id: item.id, financialAccountId: item.financialAccountId, fileName: item.fileName, importedRows: item.importedRows, matchedRows: item.matchedRows, createdAt: item.createdAt.toISOString() })),
      statementLines: statementLines.map((item) => ({ id: item.id, importId: item.importId, financialEntryId: item.financialEntryId, occurredAt: item.occurredAt.toISOString(), description: item.description, amountCents: money(item.amountCents), status: item.status })),
      attachments: attachments.map((item) => ({ id: item.id, financialEntryId: item.financialEntryId, fileName: item.fileName, mimeType: item.mimeType, sizeBytes: item.sizeBytes, createdAt: item.createdAt.toISOString() })),
    });
  }

  async function addAttachment(context: AuthenticatedContext, raw: unknown, content: Buffer) {
    const input = financialAttachmentMetadataSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_MANAGE, resource(context.workspaceId, input.entryId));
    if (content.byteLength < 1 || content.byteLength > 10_485_760) fail("O comprovante deve ter até 10 MB.", "FINANCE_ATTACHMENT_SIZE", 413);
    const entry = await options.database.financialEntry.findFirst({ where: { id: input.entryId, workspaceId: context.workspaceId }, select: { id: true } });
    if (!entry) fail("Lançamento não encontrado.", "FINANCE_ENTRY_NOT_FOUND", 404);
    return options.database.financialAttachment.create({ data: {
      workspaceId: context.workspaceId,
      financialEntryId: entry.id,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: content.byteLength,
      contentHash: createHash("sha256").update(content).digest("hex"),
      content: Uint8Array.from(content),
      createdByActorId: context.actorId,
    }, select: { id: true, financialEntryId: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true } });
  }

  async function getAttachment(context: AuthenticatedContext, attachmentId: string) {
    await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_READ, resource(context.workspaceId, attachmentId));
    const attachment = await options.database.financialAttachment.findFirst({ where: { id: attachmentId, workspaceId: context.workspaceId }, select: { fileName: true, mimeType: true, content: true } });
    if (!attachment) fail("Comprovante não encontrado.", "FINANCE_ATTACHMENT_NOT_FOUND", 404);
    return attachment;
  }

  async function command(context: AuthenticatedContext, raw: unknown) {
    // HTML date inputs describe a civil day in the workspace, not UTC midnight.
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const input = raw as Record<string, unknown>;
      const dateFields = ["competenceAt", "dueAt", "settledAt", "effectiveFrom", "firstDueAt", "through"].filter((key) => typeof input[key] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input[key] as string));
      if (dateFields.length) {
        const workspace = await options.database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
        raw = { ...input, ...Object.fromEntries(dateFields.map((key) => [key, workspaceDayRange(input[key] as string, workspace.timeZone).start])) };
      }
    }
    const command = financeCommandSchema.parse(raw);
    if (command.action === "CREATE_COST_CENTER") {
      const input = createCostCenterSchema.parse(command); await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_MANAGE, resource(context.workspaceId));
      return options.database.financialCostCenter.create({ data: { workspaceId: context.workspaceId, key: input.key, name: input.name, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
    }
    if (command.action === "CREATE_RECURRENCE") {
      const input = createRecurrenceSchema.parse(command); await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_MANAGE, resource(context.workspaceId));
      return options.database.$transaction(async (tx) => {
        const [category, account, costCenter] = await Promise.all([
          tx.financialCategory.findFirst({ where: { id: input.categoryId, workspaceId: context.workspaceId, kind: input.direction, active: true } }),
          tx.financialAccount.findFirst({ where: { id: input.financialAccountId, workspaceId: context.workspaceId, active: true } }),
          input.costCenterId ? tx.financialCostCenter.findFirst({ where: { id: input.costCenterId, workspaceId: context.workspaceId, active: true } }) : null,
        ]);
        if (!category || !account || (input.costCenterId && !costCenter)) fail("Categoria, conta ou centro de custo inválido.", "FINANCE_RECURRENCE_REFERENCE");
        const recurrence = await tx.financialRecurrence.create({ data: { workspaceId: context.workspaceId, categoryId: input.categoryId, financialAccountId: input.financialAccountId, costCenterId: input.costCenterId, direction: input.direction, description: input.description, counterparty: input.counterparty, amountCents: input.amountCents, installmentCount: input.installmentCount, firstDueAt: input.firstDueAt, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
        await tx.financialEntry.createMany({ data: Array.from({ length: input.installmentCount }, (_, index) => { const dueAt = addMonths(input.firstDueAt, index); return { workspaceId: context.workspaceId, categoryId: input.categoryId, financialAccountId: input.financialAccountId, costCenterId: input.costCenterId, recurrenceId: recurrence.id, installmentNumber: index + 1, direction: input.direction, description: `${input.description} (${index + 1}/${input.installmentCount})`, counterparty: input.counterparty, amountCents: input.amountCents, competenceAt: dueAt, dueAt, approvalStatus: input.direction === "EXPENSE" && input.requiresApproval ? "PENDING" as const : "NOT_REQUIRED" as const, idempotencyKey: `finance:recurrence:${recurrence.id}:${index + 1}`, createdByActorId: context.actorId, updatedByActorId: context.actorId }; }) });
        return recurrence;
      });
    }
    if (command.action === "IMPORT_BANK_STATEMENT") {
      const input = importBankStatementSchema.parse(command); await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_MANAGE, resource(context.workspaceId));
      const rows = parseStatementCsv(input.csv); const contentHash = createHash("sha256").update(`${input.financialAccountId}\0${input.csv}`).digest("hex");
      return options.database.$transaction(async (tx) => {
        const replay = await tx.bankStatementImport.findUnique({ where: { workspaceId_contentHash: { workspaceId: context.workspaceId, contentHash } } }); if (replay) return replay;
        const account = await tx.financialAccount.findFirst({ where: { id: input.financialAccountId, workspaceId: context.workspaceId, active: true } }); if (!account) fail("Conta financeira não encontrada.", "FINANCE_ACCOUNT_NOT_FOUND", 404);
        const statementImport = await tx.bankStatementImport.create({ data: { workspaceId: context.workspaceId, financialAccountId: account.id, fileName: input.fileName, contentHash, importedRows: rows.length, createdByActorId: context.actorId } });
        let matchedRows = 0; const usedEntries = new Set<string>();
        for (const row of rows) {
          const direction = row.amountCents > 0n ? "INCOME" : "EXPENSE"; const amountCents = row.amountCents > 0n ? row.amountCents : -row.amountCents;
          const candidate = await tx.financialEntry.findFirst({ where: { workspaceId: context.workspaceId, financialAccountId: account.id, direction, amountCents, status: "PLANNED", approvalStatus: { in: ["NOT_REQUIRED", "APPROVED"] }, dueAt: { gte: new Date(row.occurredAt.getTime() - 3 * 86_400_000), lte: new Date(row.occurredAt.getTime() + 3 * 86_400_000) }, id: { notIn: [...usedEntries] } }, orderBy: [{ dueAt: "asc" }, { id: "asc" }] });
          if (candidate) { usedEntries.add(candidate.id); matchedRows += 1; await tx.financialEntry.update({ where: { id: candidate.id }, data: { status: "SETTLED", settledAt: row.occurredAt, revision: { increment: 1 }, updatedByActorId: context.actorId } }); }
          await tx.bankStatementLine.create({ data: { workspaceId: context.workspaceId, importId: statementImport.id, financialEntryId: candidate?.id ?? null, occurredAt: row.occurredAt, description: row.description, amountCents: row.amountCents, status: candidate ? "MATCHED" : "UNMATCHED", rawData: row.rawData, matchedAt: candidate ? options.now() : null, matchedByActorId: candidate ? context.actorId : null } });
        }
        return tx.bankStatementImport.update({ where: { id: statementImport.id }, data: { matchedRows } });
      }, { isolationLevel: "Serializable" });
    }
    if (command.action === "REVIEW_BANK_LINE") {
      const input = reviewBankLineSchema.parse(command); await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_MANAGE, resource(context.workspaceId));
      return options.database.$transaction(async (tx) => { const line = await tx.bankStatementLine.findFirst({ where: { id: input.lineId, workspaceId: context.workspaceId, status: "UNMATCHED" } }); if (!line) fail("Movimento bancário não está disponível.", "FINANCE_BANK_LINE_CONFLICT"); if (input.decision === "IGNORE") return tx.bankStatementLine.update({ where: { id: line.id }, data: { status: "IGNORED", matchedAt: options.now(), matchedByActorId: context.actorId } }); const entry = await tx.financialEntry.findFirst({ where: { id: input.entryId!, workspaceId: context.workspaceId, financialAccountId: (await tx.bankStatementImport.findUniqueOrThrow({ where: { id: line.importId } })).financialAccountId, status: { in: ["PLANNED", "SETTLED"] } } }); if (!entry || entry.amountCents !== (line.amountCents > 0n ? line.amountCents : -line.amountCents) || entry.direction !== (line.amountCents > 0n ? "INCOME" : "EXPENSE")) fail("O lançamento não corresponde ao valor e natureza do extrato.", "FINANCE_BANK_MATCH_INVALID"); if (entry.status === "PLANNED" && !["NOT_REQUIRED", "APPROVED"].includes(entry.approvalStatus)) fail("A despesa precisa ser aprovada antes da conciliação.", "FINANCE_EXPENSE_APPROVAL_REQUIRED"); if (entry.status === "PLANNED") await tx.financialEntry.update({ where: { id: entry.id }, data: { status: "SETTLED", settledAt: line.occurredAt, revision: { increment: 1 }, updatedByActorId: context.actorId } }); return tx.bankStatementLine.update({ where: { id: line.id }, data: { status: "MATCHED", financialEntryId: entry.id, matchedAt: options.now(), matchedByActorId: context.actorId } }); });
    }
    if (command.action === "REVIEW_EXPENSE") {
      const input = reviewExpenseSchema.parse(command); await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_MANAGE, resource(context.workspaceId, input.entryId));
      const updated = await options.database.financialEntry.updateMany({ where: { id: input.entryId, workspaceId: context.workspaceId, direction: "EXPENSE", approvalStatus: "PENDING", revision: input.expectedRevision }, data: { approvalStatus: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", approvalReason: input.reason, approvedAt: options.now(), approvedByActorId: context.actorId, revision: { increment: 1 }, updatedByActorId: context.actorId } }); if (!updated.count) fail("Despesa já revisada ou alterada.", "FINANCE_EXPENSE_REVIEW_CONFLICT"); return { reviewed: true };
    }
    if (command.action === "CREATE_CATEGORY") {
      const input = createFinancialCategorySchema.parse(command);
      await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_MANAGE, resource(context.workspaceId));
      return options.database.financialCategory.create({ data: { workspaceId: context.workspaceId, key: input.key, name: input.name, kind: input.kind, dreGroup: input.dreGroup, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
    }
    if (command.action === "CREATE_ACCOUNT") {
      const input = createFinancialAccountSchema.parse(command);
      await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_MANAGE, resource(context.workspaceId));
      return options.database.financialAccount.create({ data: { workspaceId: context.workspaceId, name: input.name, type: input.type, openingBalanceCents: input.openingBalanceCents, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
    }
    if (command.action === "CREATE_ENTRY") {
      const input = createFinancialEntrySchema.parse(command);
      await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_MANAGE, resource(context.workspaceId));
      return options.database.$transaction(async (tx) => {
        const replay = await tx.financialEntry.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
        if (replay) return replay;
        const [category, account, customer] = await Promise.all([
          tx.financialCategory.findFirst({ where: { id: input.categoryId, workspaceId: context.workspaceId, active: true } }),
          tx.financialAccount.findFirst({ where: { id: input.financialAccountId, workspaceId: context.workspaceId, active: true } }),
          input.customerAccountId ? tx.account.findFirst({ where: { id: input.customerAccountId, workspaceId: context.workspaceId, deletedAt: null } }) : null,
        ]);
        if (!category || category.kind !== input.direction) fail("Categoria financeira incompatível com o lançamento.", "FINANCE_CATEGORY_MISMATCH");
        if (!account) fail("Conta financeira não encontrada.", "FINANCE_ACCOUNT_NOT_FOUND", 404);
        if (input.customerAccountId && !customer) fail("Cliente não encontrado neste workspace.", "FINANCE_CUSTOMER_NOT_FOUND", 404);
        if (input.costCenterId && !(await tx.financialCostCenter.findFirst({ where: { id: input.costCenterId, workspaceId: context.workspaceId, active: true } }))) fail("Centro de custo não encontrado.", "FINANCE_COST_CENTER_NOT_FOUND", 404);
        return tx.financialEntry.create({ data: { workspaceId: context.workspaceId, categoryId: input.categoryId, financialAccountId: input.financialAccountId, customerAccountId: input.customerAccountId, costCenterId: input.costCenterId, direction: input.direction, status: input.status, description: input.description, counterparty: input.counterparty, amountCents: input.amountCents, competenceAt: input.competenceAt, dueAt: input.dueAt, settledAt: input.settledAt, approvalStatus: input.direction === "EXPENSE" && input.requiresApproval ? "PENDING" : "NOT_REQUIRED", idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      });
    }
    if (command.action === "SETTLE_ENTRY") {
      const input = settleFinancialEntrySchema.parse(command);
      await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_MANAGE, resource(context.workspaceId, input.entryId));
      const result = await options.database.financialEntry.updateMany({ where: { id: input.entryId, workspaceId: context.workspaceId, status: "PLANNED", revision: input.expectedRevision, ...(input.status === "SETTLED" ? { approvalStatus: { in: ["NOT_REQUIRED", "APPROVED"] } } : {}) }, data: input.status === "SETTLED" ? { status: "SETTLED", settledAt: input.settledAt, revision: { increment: 1 }, updatedByActorId: context.actorId } : { status: "CANCELLED", cancelledAt: options.now(), cancellationReason: input.reason, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      if (result.count !== 1) fail("Lançamento alterado ou indisponível.", "FINANCE_ENTRY_CONFLICT");
      return options.database.financialEntry.findFirstOrThrow({ where: { id: input.entryId, workspaceId: context.workspaceId } });
    }
    if (command.action === "CREATE_COMMISSION_RULE") {
      const input = createCommissionRuleSchema.parse(command);
      await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_COMMISSIONS, resource(context.workspaceId, undefined, input.sellerMemberId));
      return options.database.$transaction(async (tx) => {
        const seller = await tx.workspaceMember.findFirst({ where: { id: input.sellerMemberId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null } });
        if (!seller) fail("Vendedor não encontrado neste workspace.", "FINANCE_SELLER_NOT_FOUND", 404);
        const laterRule = await tx.commissionRule.findFirst({ where: { workspaceId: context.workspaceId, sellerMemberId: input.sellerMemberId, effectiveFrom: { gte: input.effectiveFrom } } });
        if (laterRule) fail("Já existe regra com início igual ou posterior. A nova vigência deve ser posterior à última regra.", "FINANCE_COMMISSION_RULE_OVERLAP");
        await tx.commissionRule.updateMany({ where: { workspaceId: context.workspaceId, sellerMemberId: input.sellerMemberId, active: true, effectiveFrom: { lt: input.effectiveFrom } }, data: { active: false, effectiveTo: input.effectiveFrom, updatedByActorId: context.actorId } });
        const rule = await tx.commissionRule.create({ data: { workspaceId: context.workspaceId, sellerMemberId: input.sellerMemberId, percentageBps: input.percentageBps, basis: input.basis, trigger: input.trigger, effectiveFrom: input.effectiveFrom, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
        const reconciliation = await reconcileCommissionsInTransaction(tx, context, options.now());
        return { rule, reconciliation };
      }, { isolationLevel: "Serializable" });
    }
    if (command.action === "RECONCILE_COMMISSIONS") {
      const input = reconcileCommissionsSchema.parse(command);
      await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_COMMISSIONS, resource(context.workspaceId));
      return options.database.$transaction((tx) => reconcileCommissionsInTransaction(tx, context, input.through ?? options.now()), { isolationLevel: "Serializable" });
    }
    const input = updateCommissionSchema.parse(command);
    await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_COMMISSIONS, resource(context.workspaceId, input.commissionId));
    if (input.status === "PAID") await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_MANAGE, resource(context.workspaceId));
    return options.database.$transaction(async (tx) => {
      const current = await tx.commission.findFirst({ where: { id: input.commissionId, workspaceId: context.workspaceId } });
      if (!current) fail("Comissão não encontrada.", "FINANCE_COMMISSION_NOT_FOUND", 404);
      if (!nextCommissionStatus(current.status, input.status)) fail("Transição de comissão inválida.", "FINANCE_COMMISSION_TRANSITION");
      const at = options.now();
      if (input.status === "PAID") {
        const account = await tx.financialAccount.findFirst({ where: { id: input.financialAccountId!, workspaceId: context.workspaceId, active: true } });
        if (!account) fail("Conta financeira não encontrada.", "FINANCE_ACCOUNT_NOT_FOUND", 404);
        if (current.amountCents > 0n) {
          const category = await tx.financialCategory.upsert({
            where: { workspaceId_key: { workspaceId: context.workspaceId, key: "comissoes_vendas" } },
            create: { workspaceId: context.workspaceId, key: "comissoes_vendas", name: "Comissões de vendas", kind: "EXPENSE", dreGroup: "despesas_operacionais", createdByActorId: context.actorId, updatedByActorId: context.actorId },
            update: {},
          });
          if (category.kind !== "EXPENSE" || !category.active) fail("A categoria comissoes_vendas deve estar ativa e ser de despesa.", "FINANCE_CATEGORY_MISMATCH");
          await tx.financialEntry.create({ data: {
            workspaceId: context.workspaceId, categoryId: category.id, financialAccountId: account.id,
            direction: "EXPENSE", status: "SETTLED", description: `Comissão da venda ${current.opportunityId}`,
            amountCents: current.amountCents, competenceAt: current.earnedAt, dueAt: at, settledAt: at,
            idempotencyKey: `finance:commission-payment:${current.id}`, createdByActorId: context.actorId, updatedByActorId: context.actorId,
          } });
        }
      }
      const result = await tx.commission.updateMany({ where: { id: current.id, workspaceId: context.workspaceId, status: current.status, revision: input.expectedRevision }, data: input.status === "APPROVED" ? { status: "APPROVED", approvedAt: at, approvedByActorId: context.actorId, revision: { increment: 1 }, updatedByActorId: context.actorId } : { status: "PAID", paidAt: at, paidByActorId: context.actorId, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      if (result.count !== 1) fail("Comissão alterada por outra pessoa.", "FINANCE_COMMISSION_CONFLICT");
      return tx.commission.findFirstOrThrow({ where: { id: current.id, workspaceId: context.workspaceId } });
    }, { isolationLevel: "Serializable" });
  }

  return Object.freeze({ screen, command, addAttachment, getAttachment });
}

let service: ReturnType<typeof createFinanceService> | undefined;
export function getFinanceService() {
  service ??= createFinanceService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
