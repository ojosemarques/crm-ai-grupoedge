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
  nextCommissionStatus,
  reconcileCommissionsSchema,
  settleFinancialEntrySchema,
  updateCommissionSchema,
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
      select: { id: true, ownerMemberId: true, amountCents: true, tcvCents: true, currency: true, closedAt: true },
    });
    const existing = new Set((await tx.commission.findMany({
      where: { workspaceId: context.workspaceId, opportunityId: { in: opportunities.map((item) => item.id) } },
      select: { opportunityId: true },
    })).map((item) => item.opportunityId));
    for (const opportunity of opportunities) {
      if (existing.has(opportunity.id)) continue;
      const contract = await tx.commercialContract.findFirst({
        where: { workspaceId: context.workspaceId, opportunityId: opportunity.id, status: "ACCEPTED" },
        select: { id: true },
      });
      const basisCents = opportunity.tcvCents > 0n ? opportunity.tcvCents : opportunity.amountCents;
      await tx.commission.create({ data: {
        workspaceId: context.workspaceId,
        ruleId: rule.id,
        sellerMemberId: rule.sellerMemberId,
        opportunityId: opportunity.id,
        contractId: contract?.id ?? null,
        basisCents,
        percentageBps: rule.percentageBps,
        amountCents: commissionAmountCents(basisCents, rule.percentageBps),
        currency: opportunity.currency,
        earnedAt: opportunity.closedAt!,
        idempotencyKey: `finance:commission:${opportunity.id}`,
        createdByActorId: context.actorId,
        updatedByActorId: context.actorId,
      } });
      created += 1;
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
    const [categories, financialAccounts, entries, invoices, payments, subscriptions, movements, opportunities, rules, commissions, members, priorManualBalances] = await Promise.all([
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
      ...entries.map((item) => ({ id: item.id, type: "MANUAL" as const, sourceLabel: "Lançamento manual", categoryId: item.categoryId, categoryName: categoryName.get(item.categoryId) ?? "Sem categoria", financialAccountId: item.financialAccountId, customerAccountId: item.customerAccountId, customerName: null, direction: item.direction, status: item.status, description: item.description, counterparty: item.counterparty, amountCents: money(item.amountCents), competenceAt: iso(item.competenceAt), dueAt: iso(item.dueAt), settledAt: iso(item.settledAt), revision: item.revision })),
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
      receivedCents: money(received), incomeCents: money(received + reversals), expenseCents: money(manualExpenses + reversals), resultCents: money(received - manualExpenses), cashBalanceCents: money(cashBalance), mrrCents: money(mrr), tcvCents: money(tcv), netRevenueCents: money(statement.netRevenue), grossProfitCents: money(statement.grossProfit), netIncomeCents: money(statement.netIncome), receivableOpenCents: money(openManual("INCOME") + invoices.reduce((sum, item) => sum + item.totalCents - item.paidCents, 0n)), payableOpenCents: money(openManual("EXPENSE")), commissionCents: money(commissions.reduce((sum, item) => sum + item.amountCents, 0n)), commissionGeneratedCents: money(periodCommissions.reduce((sum, item) => sum + item.amountCents, 0n)), commissionPendingCents: money(commissionTotal("PENDING")), commissionApprovedCents: money(commissionTotal("APPROVED")), commissionPaidCents: money(commissionTotal("PAID")), newMrrCents: money(movements.filter((item) => item.type === "NEW").reduce((sum, item) => sum + item.deltaMrrCents, 0n)), churnMrrCents: money(movements.filter((item) => item.type === "CHURN").reduce((sum, item) => sum + -item.deltaMrrCents, 0n)),
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
      commissionRules: rules.map((item) => ({ id: item.id, sellerMemberId: item.sellerMemberId, sellerName: memberName.get(item.sellerMemberId) ?? "Membro indisponível", percentageBps: item.percentageBps, active: item.active, effectiveFrom: item.effectiveFrom.toISOString(), effectiveTo: iso(item.effectiveTo) })),
      commissions: commissions.map((item) => ({ id: item.id, ruleId: item.ruleId, sellerMemberId: item.sellerMemberId, sellerName: memberName.get(item.sellerMemberId) ?? "Membro indisponível", opportunityId: item.opportunityId, contractId: item.contractId, status: item.status, basisCents: money(item.basisCents), percentageBps: item.percentageBps, amountCents: money(item.amountCents), earnedAt: item.earnedAt.toISOString(), approvedAt: iso(item.approvedAt), paidAt: iso(item.paidAt), revision: item.revision })),
    });
  }

  async function command(context: AuthenticatedContext, raw: unknown) {
    // HTML date inputs describe a civil day in the workspace, not UTC midnight.
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const input = raw as Record<string, unknown>;
      const dateFields = ["competenceAt", "dueAt", "settledAt", "effectiveFrom", "through"].filter((key) => typeof input[key] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input[key] as string));
      if (dateFields.length) {
        const workspace = await options.database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
        raw = { ...input, ...Object.fromEntries(dateFields.map((key) => [key, workspaceDayRange(input[key] as string, workspace.timeZone).start])) };
      }
    }
    const command = financeCommandSchema.parse(raw);
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
        return tx.financialEntry.create({ data: { workspaceId: context.workspaceId, categoryId: input.categoryId, financialAccountId: input.financialAccountId, customerAccountId: input.customerAccountId, direction: input.direction, status: input.status, description: input.description, counterparty: input.counterparty, amountCents: input.amountCents, competenceAt: input.competenceAt, dueAt: input.dueAt, settledAt: input.settledAt, idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      });
    }
    if (command.action === "SETTLE_ENTRY") {
      const input = settleFinancialEntrySchema.parse(command);
      await options.authorization.assertAuthorized(context, PermissionKeys.FINANCE_MANAGE, resource(context.workspaceId, input.entryId));
      const result = await options.database.financialEntry.updateMany({ where: { id: input.entryId, workspaceId: context.workspaceId, status: "PLANNED", revision: input.expectedRevision }, data: input.status === "SETTLED" ? { status: "SETTLED", settledAt: input.settledAt, revision: { increment: 1 }, updatedByActorId: context.actorId } : { status: "CANCELLED", cancelledAt: options.now(), cancellationReason: input.reason, revision: { increment: 1 }, updatedByActorId: context.actorId } });
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
        const rule = await tx.commissionRule.create({ data: { workspaceId: context.workspaceId, sellerMemberId: input.sellerMemberId, percentageBps: input.percentageBps, effectiveFrom: input.effectiveFrom, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
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

  return Object.freeze({ screen, command });
}

let service: ReturnType<typeof createFinanceService> | undefined;
export function getFinanceService() {
  service ??= createFinanceService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
