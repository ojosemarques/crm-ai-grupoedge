import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import {
  calculateFixedCloserCommission,
  evaluateInstallmentRelease,
  projectCloserMonth,
} from "@/modules/finance/domain/closer-compensation";
import { firstDateOfNextMonth, resolveCloserReleaseDates } from "@/modules/finance/domain/closer-release-calendar";
import { workspaceDateAt } from "@/shared/core/time/workspace-time";
import { readCloserCompensationFacts } from "./closer-compensation-facts";

const changedAfterApproval = "A base mudou após a aprovação ou baixa.";

export async function reconcileCloserCompensation(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  evaluatedAt: Date,
) {
  const policy = await tx.commercialCompensationPolicy.findFirst({ where: { workspaceId }, select: { version: true } });
  if (!policy) return new Set<string>();

  // Serializa a mesma competência mesmo quando eventos chegam de cobranças distintas.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`commercial-compensation:${workspaceId}`}, 0))`;
  const { sales, timeZone, evaluatedOn, policyActive, policies } = await readCloserCompensationFacts(tx, workspaceId, evaluatedAt);
  const coveredIds = new Set(sales.map((sale) => sale.opportunityId));
  if (!policyActive) return coveredIds;

  const [plans, legacy, obligations] = await Promise.all([
    tx.otePlan.findMany({
      where: { workspaceId, memberId: { in: [...new Set(sales.map((sale) => sale.sellerMemberId))] } },
      orderBy: { effectiveMonth: "desc" },
    }),
    tx.commission.findMany({
      where: { workspaceId, opportunityId: { in: [...coveredIds] } },
      select: { opportunityId: true }, distinct: ["opportunityId"],
    }),
    tx.commercialCompensationObligation.findMany({
      where: { workspaceId, OR: [
        { kind: "SALE_COMMISSION", obligationKey: { startsWith: "closer:sale:" } },
        { kind: "CLOSER_BONUS" },
      ] },
      select: {
        obligationKey: true, opportunityId: true, amountCents: true, basisCents: true, status: true,
        reason: true, competenceMonth: true, sellerMemberId: true, policyVersion: true,
        milestoneOn: true, eligibleAt: true, dueOn: true, sourceFacts: true, _count: { select: { allocations: true } },
      },
    }),
  ]);
  const legacyIds = new Set(legacy.map((item) => item.opportunityId));
  const existing = new Map(obligations.map((row) => [row.obligationKey, row]));
  const salesById = new Map(sales.map((sale) => [sale.opportunityId, sale]));
  const calendars = new Map(policies.map((policy) => [policy.version, policy.calendarVerifiedThrough
    ? { throughOn: localDateColumn(policy.calendarVerifiedThrough), holidays: new Set(policy.calendarHolidays.map(localDateColumn)) }
    : null]));
  const findPlan = (sellerMemberId: string, month: string) =>
    plans.find((candidate) => candidate.memberId === sellerMemberId && candidate.effectiveMonth <= month);
  const monthly = new Map<string, {
    month: string;
    sellerMemberId: string;
    sales: Parameters<typeof projectCloserMonth>[0]["sales"][number][];
  }>();
  for (const sale of sales) {
    if (!sale.d0 || !sale.confirmation || legacyIds.has(sale.opportunityId)) continue;
    const month = workspaceDateAt(sale.d0, timeZone).slice(0, 7);
    const key = `${sale.sellerMemberId}:${month}`;
    const bucket = monthly.get(key) ?? { month, sellerMemberId: sale.sellerMemberId, sales: [] };
    bucket.sales.push({
      opportunityId: sale.opportunityId, modality: sale.confirmation.modality,
      acvCents: sale.confirmation.netContractCents,
      netSettledCents: sale.evidenced.reduce((sum, payment) => sum + payment.netCents, 0n),
      selfSourced: sale.confirmation.selfSourced, d0: sale.d0, recordedAt: sale.confirmation.confirmedAt,
    });
    monthly.set(key, bucket);
  }

  const installmentCalculations = new Map<string, NonNullable<ReturnType<typeof projectCloserMonth>["sales"][number]["commission"]>>();
  const bonusKeys = new Set<string>();
  for (const { month, sellerMemberId, sales: monthlySales } of monthly.values()) {
    const plan = findPlan(sellerMemberId, month);
    if (plan?.role !== "CLOSER" || plan.quotaCents <= 0n) continue;
    const ramp = plan.rampMonth === month;
    if (ramp && !plan.rampEvidence?.trim()) continue;
    const planInput = ramp ? { kind: "RAMP" as const } : { kind: "TARGET" as const, targetCents: plan.quotaCents };
    const projection = projectCloserMonth({ month, timeZone, plan: planInput, sales: monthlySales });
    for (const item of projection.sales) {
      if (item.commission) installmentCalculations.set(item.opportunityId, item.commission);
    }
    const policyVersion = salesById.get(projection.sales.at(-1)?.opportunityId ?? "")?.policyVersion;
    if (!policyVersion || !projection.reachesTarget || plan.bonusCents <= 0n || month >= evaluatedOn.slice(0, 7)) continue;
    const obligationKey = `closer:bonus:${sellerMemberId}:${month}`;
    bonusKeys.add(obligationKey);
    const milestoneOn = firstDateOfNextMonth(month);
    const lateEvidence = projection.sales.some(({ opportunityId }) => {
      const sale = salesById.get(opportunityId)!;
      const firstReceipt = sale.evidenced.find((payment) => payment.netCents > 0n)!;
      return [firstReceipt.recordedAt, sale.confirmation!.confirmedAt].some((date) => workspaceDateAt(date, timeZone) >= milestoneOn);
    });
    const dates = resolveCloserReleaseDates({
      cycle: "MONTHLY", milestoneOn, timeZone, evaluatedOn, calendar: lateEvidence ? null : calendars.get(policyVersion) ?? null,
    });
    await persistCloserObligation(tx, workspaceId, obligationKey, existing.get(obligationKey), {
      kind: "CLOSER_BONUS",
      opportunityId: null,
      sellerMemberId, policyVersion, competenceMonth: month, amountCents: plan.bonusCents,
      basisCents: projection.newAcvCents, milestoneOn: new Date(milestoneOn),
      eligibleAt: dates.eligibleAt, dueOn: dates.dueOn,
      status: lateEvidence ? "REVIEW" : dates.eligibleAt ? "ELIGIBLE" : "PENDING",
      reason: lateEvidence ? "Evidência de atingimento registrada após o fechamento." : dates.eligibleAt ? null : "Calendário de pagamento sem cobertura verificada.",
      sourceFacts: {
        planId: plan.id, planRevision: plan.revision, targetCents: plan.quotaCents.toString(),
        opportunityIds: projection.sales.map((sale) => sale.opportunityId), releaseOn: dates.releaseOn,
      },
    });
  }
  for (const prior of obligations) {
    const bonusLost = prior.opportunityId === null && !bonusKeys.has(prior.obligationKey);
    const saleRemoved = prior.opportunityId !== null && !coveredIds.has(prior.opportunityId);
    if ((bonusLost || saleRemoved) && prior.status !== "REVIEW") {
      const reason = bonusLost
        ? "Os fatos vigentes deixaram de comprovar a meta da competência."
        : "A venda deixou de constar no recorte da política.";
      await flagCloserReview(tx, workspaceId, prior.obligationKey, prior, reason);
    }
  }

  for (const sale of sales) {
    const obligationKey = `closer:sale:${sale.opportunityId}`;
    const prior = existing.get(obligationKey);
    const confirmation = sale.confirmation;
    const d0On = sale.d0 ? workspaceDateAt(sale.d0, timeZone) : null;
    const d0Month = d0On?.slice(0, 7);
    const plan = d0Month && findPlan(sale.sellerMemberId, d0Month);
    const prepaidIncomplete = confirmation?.modality === "ANNUAL_PREPAID" &&
      (sale.scheduledCents !== confirmation.netContractCents || sale.grossSettledCents < confirmation.netContractCents ||
        sale.missingNetPaymentIds.length > 0);
    const commission = confirmation && sale.d0 && plan && plan.role === "CLOSER" && !prepaidIncomplete && !legacyIds.has(sale.opportunityId)
      ? confirmation.modality === "ANNUAL_INSTALLMENTS"
        ? installmentCalculations.get(sale.opportunityId)
        : calculateFixedCloserCommission({
          modality: confirmation.modality, acvCents: confirmation.netContractCents,
          netSettledCents: sale.evidenced.reduce((sum, payment) => sum + payment.netCents, 0n),
          selfSourced: confirmation.selfSourced,
        })
      : null;
    if (!commission || commission.amountCents <= 0n || !confirmation || !sale.d0 || !d0On || !d0Month || !plan) {
      if (prior && prior.status !== "REVIEW") {
        const reason = "Os fatos vigentes deixaram de comprovar a base da obrigação.";
        await flagCloserReview(tx, workspaceId, obligationKey, prior, reason);
      }
      continue;
    }

    const release = confirmation.modality === "ANNUAL_INSTALLMENTS" ? evaluateInstallmentRelease({
      d0On,
      evaluatedOn, acvCents: confirmation.netContractCents, active: sale.active,
      hasOverdueBalance: sale.overdueInvoiceIds.length > 0, settlements: sale.evidenced,
      commissionCents: commission.amountCents, paidCents: 0n, openCents: 0n,
    }) : null;
    const prepaid = confirmation.modality === "ANNUAL_PREPAID";
    const lastSettlementOn = sale.evidenced.at(-1)?.settledOn ?? d0On;
    const competenceMonth = prepaid && lastSettlementOn > d0On ? lastSettlementOn.slice(0, 7) : d0Month;
    const milestoneOn = release?.milestoneOn ?? (prepaid ? firstDateOfNextMonth(competenceMonth) : null);
    const lateEvidence = prepaid && milestoneOn && [confirmation.confirmedAt, ...sale.evidenced.map((payment) => payment.recordedAt)]
      .some((date) => workspaceDateAt(date, timeZone) >= milestoneOn);
    const reviewReason = !milestoneOn ? "Calendário da modalidade exige condição documentada."
      : sale.missingNetPaymentIds.length ? "Há recebimento com valor líquido pendente de comprovação."
        : lateEvidence ? "Evidência de liquidação registrada após o fechamento." : null;
    let reason = reviewReason;
    if (!reason && !sale.active) reason = "Aguardando ativação vigente.";
    if (!reason && sale.overdueInvoiceIds.length) reason = "Há cobrança vencida com saldo.";
    if (!reason && milestoneOn && evaluatedOn < milestoneOn) reason = "Aguardando o marco de elegibilidade.";
    if (!reason && release && !release.meetsConditions) reason = "Caixa líquido abaixo do mínimo exigido.";
    const dates = !reason && milestoneOn ? resolveCloserReleaseDates({
      cycle: prepaid ? "MONTHLY" : "INSTALLMENT", milestoneOn, timeZone, evaluatedOn,
      calendar: calendars.get(sale.policyVersion) ?? null,
      previousReleaseOn: prior?.milestoneOn && localDateColumn(prior.milestoneOn) === milestoneOn
        ? readReleaseOn(prior.sourceFacts) : undefined,
    }) : { releaseOn: null, eligibleAt: null, dueOn: null };
    if (!reason && !dates.eligibleAt) reason = dates.releaseOn
      ? "Aguardando a data útil de liberação." : "Calendário de pagamento sem cobertura verificada.";
    const sourceFacts = {
      confirmationRevision: confirmation.revision, modality: confirmation.modality, d0: sale.d0.toISOString(),
      contractId: sale.contractId, contractVersionId: sale.contractVersionId,
      planId: plan.id, planRevision: plan.revision,
      settlements: sale.evidenced.map((payment) => ({
        id: payment.id, invoiceId: payment.invoiceId, settledOn: payment.settledOn,
        recordedAt: payment.recordedAt.toISOString(),
        grossCents: payment.amountCents.toString(), netCents: payment.netCents.toString(),
        upfrontNetCents: payment.netUpfrontCents?.toString() ?? null,
      })),
      missingNetPaymentIds: sale.missingNetPaymentIds,
      overdueInvoiceIds: sale.overdueInvoiceIds,
      active: sale.active,
      releaseOn: dates.releaseOn,
      installmentConditionsMet: release?.meetsConditions ?? null,
      grossSettledCents: sale.grossSettledCents.toString(),
      scheduledCents: sale.scheduledCents.toString(),
      tiers: "tiers" in commission
        ? commission.tiers.map((tier) => ({ basisCents: tier.basisCents.toString(), rateBps: tier.rateBps.toString() }))
        : [{ basisCents: commission.basisCents.toString(), rateBps: commission.rateBps.toString() }],
    };
    await persistCloserObligation(tx, workspaceId, obligationKey, prior, {
      kind: "SALE_COMMISSION", opportunityId: sale.opportunityId,
      sellerMemberId: sale.sellerMemberId, policyVersion: sale.policyVersion,
      competenceMonth, amountCents: commission.amountCents,
      basisCents: "basisCents" in commission ? commission.basisCents : confirmation.netContractCents,
      milestoneOn: milestoneOn ? new Date(milestoneOn) : null,
      eligibleAt: dates.eligibleAt, dueOn: dates.dueOn,
      status: reviewReason ? "REVIEW" : dates.eligibleAt ? "ELIGIBLE" : "PENDING",
      reason, sourceFacts,
    });
  }
  return coveredIds;
}

function localDateColumn(value: Date) {
  return value.toISOString().slice(0, 10);
}

function readReleaseOn(facts: Prisma.JsonValue) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return undefined;
  const date = facts.releaseOn;
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

async function persistCloserObligation(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  obligationKey: string,
  prior: Prisma.CommercialCompensationObligationGetPayload<{ select: {
    sellerMemberId: true; policyVersion: true; competenceMonth: true; amountCents: true; basisCents: true;
    milestoneOn: true; eligibleAt: true; dueOn: true; sourceFacts: true; status: true; reason: true; _count: { select: { allocations: true } };
  } }> | undefined,
  data: Omit<Prisma.CommercialCompensationObligationUncheckedCreateInput, "workspaceId" | "obligationKey"> & {
    milestoneOn: Date | null; eligibleAt: Date | null; dueOn: Date | null; sourceFacts: Prisma.InputJsonObject;
  },
) {
  const where = { workspaceId_obligationKey: { workspaceId, obligationKey } };
  if (!prior) {
    await tx.commercialCompensationObligation.create({ data: { ...data, workspaceId, obligationKey } });
    return;
  }
  // JSONB não preserva a ordem das chaves. Compare os objetos por sua forma canônica.
  const unchanged = prior.sellerMemberId === data.sellerMemberId && prior.policyVersion === data.policyVersion &&
    prior.competenceMonth === data.competenceMonth && prior.amountCents === data.amountCents && prior.basisCents === data.basisCents &&
    prior.milestoneOn?.getTime() === data.milestoneOn?.getTime() &&
    prior.eligibleAt?.getTime() === data.eligibleAt?.getTime() && prior.dueOn?.getTime() === data.dueOn?.getTime() &&
    canonicalJson(prior.sourceFacts) === canonicalJson(data.sourceFacts);
  if (unchanged && prior.status === data.status && prior.reason === data.reason) return;
  if (prior._count.allocations || prior.reason === changedAfterApproval || ["APPROVED", "PAID"].includes(prior.status)) {
    if (!unchanged) await flagCloserReview(tx, workspaceId, obligationKey, prior, changedAfterApproval, data.sourceFacts);
    return;
  }
  await tx.commercialCompensationObligation.update({ where, data: { ...data, revision: { increment: 1 } } });
}

function canonicalJson(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    : item);
}

async function flagCloserReview(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  obligationKey: string,
  prior: { status: string; reason: string | null },
  reason: string,
  facts?: Prisma.InputJsonObject,
) {
  if (prior.status === "APPROVED") reason = changedAfterApproval;
  const sourceEventKey = createHash("sha256").update(canonicalJson({ reason, facts })).digest("hex");
  await tx.commercialCompensationReview.upsert({
    where: { workspaceId_obligationKey_sourceEventKey: { workspaceId, obligationKey, sourceEventKey } },
    create: { workspaceId, obligationKey, sourceEventKey, reason },
    update: {},
  });
  if (prior.status !== "PAID" && (prior.status !== "REVIEW" || prior.reason !== reason)) {
    await tx.commercialCompensationObligation.update({
      where: { workspaceId_obligationKey: { workspaceId, obligationKey } },
      data: { status: "REVIEW", reason, revision: { increment: 1 } },
    });
  }
}
