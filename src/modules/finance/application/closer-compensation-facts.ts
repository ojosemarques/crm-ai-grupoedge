import type { Prisma } from "@/generated/prisma/client";
import { resolveCloserD0 } from "@/modules/finance/domain/closer-compensation";
import { PAYMENT_PROVIDER_KEY } from "@/modules/payments/domain/payment-contracts";
import { workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";

export async function readCloserCompensationFacts(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  through: Date,
) {
  const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timeZone: true } });
  const { timeZone } = workspace;
  const evaluatedOn = workspaceDateAt(through, timeZone);
  const policies = await tx.commercialCompensationPolicy.findMany({
    where: { workspaceId, effectiveDate: { lte: new Date(evaluatedOn) } },
    orderBy: { effectiveDate: "desc" },
  });
  const earliest = policies.at(-1);
  if (!earliest) return { policyActive: false, timeZone, evaluatedOn, policies, sales: [] };
  const startsAt = workspaceDayRange(earliest.effectiveDate.toISOString().slice(0, 10), timeZone).start;
  const opportunities = await tx.opportunity.findMany({
    where: { workspaceId, deletedAt: null, status: "WON", currency: "BRL", closedAt: { gte: startsAt, lte: through } },
    select: {
      id: true,
      ownerMemberId: true,
      closedAt: true,
      saleConfirmations: { where: { confirmedAt: { lte: through } }, orderBy: { revision: "desc" }, take: 1 },
      commercialContract: { select: {
        id: true,
        status: true,
        currentVersionId: true,
        invoices: {
          where: { status: { notIn: ["CANCELLED", "VOIDED", "DRAFT"] } },
          orderBy: [{ dueAt: "asc" }, { id: "asc" }],
          select: {
            id: true, totalCents: true, dueAt: true,
            payments: {
              where: {
                providerKey: { not: PAYMENT_PROVIDER_KEY },
                occurredAt: { lte: through },
                recordedAt: { lte: through },
                OR: [
                  { status: "CONFIRMED", reversedAt: null },
                  { status: { in: ["REVERSED", "CHARGEBACK"] }, reversedAt: { gt: through } },
                ],
              },
              select: { id: true, amountCents: true, netSettledCents: true, netUpfrontCents: true, occurredAt: true, recordedAt: true },
            },
          },
        },
      } },
    },
  });
  const contractIds = opportunities.flatMap((sale) => sale.commercialContract ? [sale.commercialContract.id] : []);
  const subscriptions = await tx.subscription.findMany({
    where: { workspaceId, contractId: { in: contractIds } },
    select: { contractId: true, status: true, startsAt: true, endsAt: true, cancellationEffectiveAt: true },
  });
  const sales = opportunities.map((sale) => {
    const closedOn = workspaceDateAt(sale.closedAt!, timeZone);
    const policy = policies.find((candidate) => candidate.effectiveDate.toISOString().slice(0, 10) <= closedOn)!;
    const confirmation = sale.saleConfirmations[0] ?? null;
    const contract = sale.commercialContract;
    const invoices = contract?.invoices ?? [];
    const payments = invoices.flatMap((invoice) => invoice.payments.map((payment) => ({ ...payment, invoiceId: invoice.id })))
      .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id.localeCompare(right.id));
    const evidenced = payments.flatMap((payment) => payment.netSettledCents === null ? [] : [{
      ...payment,
      settledOn: workspaceDateAt(payment.occurredAt, timeZone),
      netCents: payment.netSettledCents,
      upfrontNetCents: payment.netUpfrontCents ?? 0n,
    }]);
    const firstSettlementAt = evidenced.find((payment) => payment.netCents > 0n)?.occurredAt ?? null;
    const d0 = confirmation ? resolveCloserD0(confirmation.acceptedAt, confirmation.activationAt, firstSettlementAt) : null;
    const active = Boolean(contract?.status === "ACCEPTED" && confirmation?.activationAt && confirmation.activationAt <= through &&
      subscriptions.some((subscription) => subscription.contractId === contract.id &&
        (subscription.status === "ACTIVE" || subscription.status === "CANCELLATION_SCHEDULED") &&
        subscription.startsAt <= through && (!subscription.endsAt || subscription.endsAt > through) &&
        (!subscription.cancellationEffectiveAt || subscription.cancellationEffectiveAt > through)));
    const overdueInvoiceIds = invoices.filter((invoice) =>
      workspaceDateAt(invoice.dueAt, timeZone) < evaluatedOn &&
      invoice.totalCents > invoice.payments.reduce((sum, payment) => sum + payment.amountCents, 0n),
    ).map((invoice) => invoice.id);
    return {
      opportunityId: sale.id, closedOn, policyVersion: policy.version, contractId: contract?.id ?? null,
      contractVersionId: contract?.currentVersionId ?? null, sellerMemberId: confirmation?.sellerMemberId ?? sale.ownerMemberId,
      confirmation, d0, active, overdueInvoiceIds, evidenced,
      scheduledCents: invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0n),
      grossSettledCents: payments.reduce((sum, payment) => sum + payment.amountCents, 0n),
      missingNetPaymentIds: payments.filter((payment) => payment.netSettledCents === null).map((payment) => payment.id),
    };
  });
  return { policyActive: true, timeZone, evaluatedOn, policies, sales };
}
