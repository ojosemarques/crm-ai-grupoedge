import type { PrismaClient } from "@/generated/prisma/client";
import type { CompensationFilters } from "@/modules/finance/domain/finance-contracts";
import { pendingLegacyPaymentAllocation } from "@/modules/finance/domain/legacy-compensation";
import { workspaceDateAt } from "@/shared/core/time/workspace-time";

export async function readCommercialCompensationScreen(
  database: PrismaClient, workspaceId: string, from: Date, to: Date, timeZone: string,
  filters: CompensationFilters = {},
) {
  const fromOn = workspaceDateAt(from, timeZone);
  const lastOn = workspaceDateAt(new Date(to.getTime() - 1), timeZone);
  const dueRange = { gte: new Date(fromOn), lte: new Date(lastOn) };
  const competenceMonth = { gte: fromOn.slice(0, 7), lte: lastOn.slice(0, 7) };
  const rows = await database.commercialCompensationObligation.findMany({
    where: { workspaceId,
      ...(filters.sellerId ? { sellerMemberId: filters.sellerId } : {}),
      ...(filters.saleId ? { opportunityId: filters.saleId } : {}),
      ...(filters.customerId ? { opportunity: { accountId: filters.customerId } } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      OR: [
      { competenceMonth },
      { dueOn: dueRange },
      { allocations: { some: { entry: { settledAt: { gte: from, lt: to } } } } },
    ] },
    include: {
      seller: { select: { user: { select: { displayName: true } } } },
      opportunity: { select: { name: true, account: { select: { id: true, name: true } } } },
      allocations: { include: { entry: { select: { settledAt: true, financialAccountId: true, description: true } } } },
      reviews: { select: { reason: true, createdAt: true }, orderBy: { createdAt: "desc" } },
    },
    orderBy: [{ competenceMonth: "desc" }, { dueOn: "asc" }, { obligationKey: "asc" }],
  });
  return rows.map((row) => {
    const paidCents = row.allocations.reduce((total, item) => total + item.amountCents, 0n);
    const periodPaidCents = row.allocations.filter((item) =>
      item.entry.settledAt && item.entry.settledAt >= from && item.entry.settledAt < to,
    ).reduce((total, item) => total + item.amountCents, 0n);
    return {
      key: row.obligationKey, kind: row.kind, status: row.status, revision: row.revision,
      sellerId: row.sellerMemberId, sellerName: row.seller.user.displayName,
      opportunityId: row.opportunityId, opportunityName: row.opportunity?.name ?? null,
      customerId: row.opportunity?.account?.id ?? null, customerName: row.opportunity?.account?.name ?? null,
      competenceMonth: row.competenceMonth, policyVersion: row.policyVersion,
      amountCents: row.amountCents.toString(), basisCents: row.basisCents?.toString() ?? null,
      paidCents: paidCents.toString(), balanceCents: (row.amountCents - paidCents).toString(),
      periodPaidCents: periodPaidCents.toString(),
      generatedInPeriod: row.competenceMonth >= competenceMonth.gte && row.competenceMonth <= competenceMonth.lte,
      dueInPeriod: Boolean(row.dueOn && row.dueOn >= dueRange.gte && row.dueOn <= dueRange.lte),
      milestoneOn: row.milestoneOn?.toISOString().slice(0, 10) ?? null,
      dueOn: row.dueOn?.toISOString().slice(0, 10) ?? null,
      eligibleAt: row.eligibleAt?.toISOString() ?? null,
      reason: row.kind === "LEGACY_STAGE" && row.reason === "Pagamento informado. Aguardando comprovante e alocação desta etapa."
        ? pendingLegacyPaymentAllocation : row.reason,
      sourceFacts: row.sourceFacts,
      payments: row.allocations.map((item) => ({
        entryId: item.financialEntryId, evidence: item.evidence, amountCents: item.amountCents.toString(),
        accountId: item.entry.financialAccountId, description: item.entry.description,
        settledAt: item.entry.settledAt?.toISOString() ?? null,
      })),
      reviews: row.reviews.map((review) => ({ reason: review.reason, createdAt: review.createdAt.toISOString() })),
    };
  });
}

export type CommercialCompensationRow = Awaited<ReturnType<typeof readCommercialCompensationScreen>>[number];
