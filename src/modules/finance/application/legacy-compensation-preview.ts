import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { resolveCloserD0 } from "@/modules/finance/domain/closer-compensation";
import { projectLegacyCompensation } from "@/modules/finance/domain/legacy-compensation";
import { PAYMENT_PROVIDER_KEY } from "@/modules/payments/domain/payment-contracts";
import { workspaceDateAt } from "@/shared/core/time/workspace-time";

const uuid = z.string().uuid();
const dateOnly = z.iso.date();
const stageDay = z.union([z.literal(30), z.literal(60), z.literal(90)]);
const positiveCents = z.string().regex(/^\d{1,16}$/).transform(BigInt).pipe(z.bigint().positive());
export const legacyManifestSchema = z.object({
  workspaceId: uuid,
  version: z.string().trim().min(3).max(100),
  cutoverOn: dateOnly,
  calendar: z.object({
    verifiedThroughOn: dateOnly, holidays: z.array(dateOnly).max(366),
    evidence: z.string().trim().min(5).max(500),
  }).strict().nullable(),
  sales: z.array(z.object({
    opportunityId: uuid, contractId: uuid, sellerMemberId: uuid, acvCents: positiveCents,
    evidence: z.string().trim().min(5).max(500),
    reported: z.object({
      on: dateOnly, stages: z.array(stageDay).min(1).max(3),
      evidence: z.string().trim().min(5).max(500),
    }).strict().nullable(),
    allocations: z.array(z.object({
      days: stageDay, financialEntryId: uuid, amountCents: positiveCents,
      settledOn: dateOnly, evidence: z.string().trim().min(5).max(500),
    }).strict()).max(12).default([]),
  }).strict()).min(1).max(100),
}).strict().refine((value) => new Set(value.sales.map((sale) => sale.opportunityId)).size === value.sales.length, "Venda repetida no manifesto.");

export async function previewLegacyCompensation(tx: Prisma.TransactionClient, manifest: z.output<typeof legacyManifestSchema>) {
  const { workspaceId } = manifest;
  const workspace = await tx.workspace.findFirstOrThrow({
    where: { id: workspaceId, status: "ACTIVE", deletedAt: null }, select: { timeZone: true },
  });
  const sales = [];
  for (const planned of manifest.sales) {
    const contract = await tx.commercialContract.findFirst({
      where: {
        workspaceId, id: planned.contractId, opportunityId: planned.opportunityId,
        status: "ACCEPTED", opportunity: { status: "WON", deletedAt: null, currency: "BRL" },
      },
      select: {
        id: true, currentVersionId: true, acceptedAt: true,
        opportunity: { select: { ownerMemberId: true, closedAt: true } },
        invoices: {
          where: { status: { notIn: ["VOIDED", "CANCELLED", "DRAFT"] } },
          orderBy: [{ dueAt: "asc" }, { id: "asc" }],
          select: { id: true, dueAt: true, totalCents: true, paidCents: true,
            payments: {
              where: { status: "CONFIRMED", reversedAt: null, netSettledCents: { gt: 0n }, providerKey: { not: PAYMENT_PROVIDER_KEY } },
              orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
              select: { id: true, occurredAt: true, netSettledCents: true },
            },
          },
        },
      },
    });
    if (!contract?.currentVersionId || !contract.opportunity.closedAt || contract.opportunity.ownerMemberId !== planned.sellerMemberId ||
      workspaceDateAt(contract.opportunity.closedAt, workspace.timeZone) >= manifest.cutoverOn) {
      throw new Error("O vínculo histórico de venda, contrato ou vendedor diverge do manifesto.");
    }
    const [version, subscriptions, existing, olderTitles] = await Promise.all([
      tx.contractVersion.findFirst({ where: { id: contract.currentVersionId, contractId: contract.id, workspaceId }, select: { totalCents: true } }),
      tx.subscription.findMany({ where: { workspaceId, contractId: contract.id }, select: { id: true, status: true } }),
      tx.commercialCompensationObligation.findMany({
        where: { workspaceId, opportunityId: planned.opportunityId },
        select: {
          obligationKey: true, kind: true, status: true, revision: true, amountCents: true, basisCents: true,
          policyVersion: true, sellerMemberId: true, competenceMonth: true, reason: true,
          milestoneOn: true, dueOn: true, sourceFacts: true,
          allocations: {
            select: { financialEntryId: true, amountCents: true },
            orderBy: { financialEntryId: "asc" },
          },
        },
        orderBy: { obligationKey: "asc" },
      }),
      tx.commission.count({ where: { workspaceId, opportunityId: planned.opportunityId } }),
    ]);
    if (version?.totalCents !== planned.acvCents) throw new Error("O valor do contrato diverge da evidência histórica.");
    const activation = await tx.revenueMovement.findFirst({
      where: { workspaceId, subscriptionId: { in: subscriptions.map((row) => row.id) }, type: "NEW", reversesMovementId: null },
      orderBy: [{ effectiveAt: "asc" }, { id: "asc" }], select: { id: true, effectiveAt: true },
    });
    const firstReceipt = contract.invoices.flatMap((invoice) => invoice.payments)
      .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id.localeCompare(right.id))[0];
    const d0 = contract.acceptedAt ? resolveCloserD0(contract.acceptedAt, activation?.effectiveAt ?? null, firstReceipt?.occurredAt ?? null) : null;
    const allocations = new Map<30 | 60 | 90, bigint>();
    const links = new Set<string>();
    for (const allocation of planned.allocations) {
      const link = `${allocation.days}:${allocation.financialEntryId}`;
      if (links.has(link)) throw new Error("Alocação histórica repetida.");
      links.add(link);
      const entry = await tx.financialEntry.findFirst({
        where: { workspaceId, id: allocation.financialEntryId, status: "SETTLED", direction: "EXPENSE", currency: "BRL",
          NOT: { idempotencyKey: { startsWith: "finance:commission-payment:" } } },
        select: { settledAt: true, amountCents: true },
      });
      if (!entry?.settledAt || workspaceDateAt(entry.settledAt, workspace.timeZone) !== allocation.settledOn || entry.amountCents < allocation.amountCents) {
        throw new Error("Despesa histórica não comprova a data ou o valor da alocação.");
      }
      allocations.set(allocation.days, (allocations.get(allocation.days) ?? 0n) + allocation.amountCents);
    }
    const stages = projectLegacyCompensation({
      acvCents: planned.acvCents, d0On: d0 ? workspaceDateAt(d0, workspace.timeZone) : null,
      verifiedThroughOn: manifest.calendar?.verifiedThroughOn ?? null, holidays: new Set(manifest.calendar?.holidays),
      possiblyPaidStages: new Set(planned.reported?.stages), allocations,
    });
    sales.push({ planned, contract, activation, firstReceipt, d0, stages, existing, olderTitles,
      competenceMonth: workspaceDateAt(d0 ?? contract.opportunity.closedAt, workspace.timeZone).slice(0, 7) });
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({ manifest, sales },
    (_key, value) => typeof value === "bigint" ? value.toString() : value)).digest("hex");
  return { fingerprint, sales };
}
