import { isBusinessDate } from "@/modules/prospecting/domain/prospecting-cadence";
import { addLocalDays, workspaceDateAt } from "@/shared/core/time/workspace-time";
import type { CommercialSaleModality } from "@/generated/prisma/enums";

const fixedRateBps = {
  ANNUAL_PREPAID: 800n,
  PROJECT: 500n,
  EXPANSION: 500n,
  NEGOTIATED_RENEWAL: 200n,
  AUTOMATIC_RENEWAL: 0n,
  AUTOMATIC_LOW_TICKET: 0n,
} satisfies Record<Exclude<CommercialSaleModality, "ANNUAL_INSTALLMENTS">, bigint>;

export function calculateFixedCloserCommission(input: {
  modality: keyof typeof fixedRateBps;
  acvCents: bigint;
  netSettledCents: bigint;
  selfSourced: boolean;
}) {
  const { modality, acvCents, netSettledCents, selfSourced } = input;
  if (acvCents < 0n || netSettledCents < 0n) {
    throw new RangeError("Base inválida para apuração de comissão.");
  }
  const baseRateBps = fixedRateBps[modality];
  const rateBps = baseRateBps > 0n && selfSourced ? baseRateBps + 100n : baseRateBps;
  const basisCents = modality === "ANNUAL_PREPAID" || modality === "PROJECT" ? netSettledCents : acvCents;
  return { basisCents, rateBps, amountCents: roundWeightedBasis(basisCents * rateBps) };
}

function roundWeightedBasis(weightedBasis: bigint) {
  return (weightedBasis + 5000n) / 10000n;
}

type CloserPlan = { kind: "RAMP" } | { kind: "TARGET"; targetCents: bigint };

export function projectCloserMonth(input: {
  month: string;
  timeZone: string;
  plan: CloserPlan | null;
  sales: readonly {
    opportunityId: string;
    modality: CommercialSaleModality;
    acvCents: bigint;
    netSettledCents: bigint;
    selfSourced: boolean;
    d0: Date | null;
    recordedAt: Date;
  }[];
}) {
  const annual = input.sales.filter((sale) => sale.modality === "ANNUAL_INSTALLMENTS" || sale.modality === "ANNUAL_PREPAID");
  const monthly = annual.flatMap((sale) =>
    sale.d0 && workspaceDateAt(sale.d0, input.timeZone).slice(0, 7) === input.month ? [{ ...sale, d0: sale.d0 }] : []);
  monthly.sort((left, right) => left.d0.getTime() - right.d0.getTime() ||
    left.recordedAt.getTime() - right.recordedAt.getTime() || left.opportunityId.localeCompare(right.opportunityId));

  let newAcvCents = 0n;
  const sales = monthly.map((sale) => {
    const commission = sale.modality === "ANNUAL_PREPAID"
      ? calculateFixedCloserCommission({ ...sale, modality: "ANNUAL_PREPAID" })
      : input.plan
        ? calculateInstallmentCommission({ ...sale, accumulatedAcvCents: newAcvCents, plan: input.plan })
        : null;
    newAcvCents += sale.acvCents;
    return { opportunityId: sale.opportunityId, commission };
  });
  return {
    sales,
    newAcvCents,
    pendingAcvCents: annual.reduce((sum, sale) => sum + (sale.d0 ? 0n : sale.acvCents), 0n),
    reachesTarget: input.plan?.kind === "TARGET" && newAcvCents >= input.plan.targetCents,
  };
}

export function resolveCloserD0(acceptedAt: Date, activationAt: Date | null, firstSettlementAt: Date | null) {
  if (!activationAt || !firstSettlementAt) return null;
  return new Date(Math.max(acceptedAt.getTime(), activationAt.getTime(), firstSettlementAt.getTime()));
}

export function calculateInstallmentCommission(input: {
  acvCents: bigint;
  accumulatedAcvCents: bigint;
  plan: CloserPlan;
  selfSourced: boolean;
}) {
  const { acvCents, accumulatedAcvCents, plan, selfSourced } = input;
  if (acvCents <= 0n || accumulatedAcvCents < 0n || (plan.kind === "TARGET" && plan.targetCents <= 0n)) {
    throw new RangeError("Base ou meta inválida para apuração de comissão.");
  }

  const tiers: { basisCents: bigint; rateBps: bigint }[] = [];
  const saleEnd = accumulatedAcvCents + acvCents;
  const boundaries = plan.kind === "RAMP"
    ? [{ end: saleEnd, rateBps: 600n }]
    : [
        { end: plan.targetCents, rateBps: 600n },
        { end: plan.targetCents * 125n / 100n, rateBps: 800n },
        { end: saleEnd, rateBps: 1000n },
      ];

  let cursor = accumulatedAcvCents;
  for (const { end, rateBps } of boundaries) {
    const tierEnd = end < saleEnd ? end : saleEnd;
    if (tierEnd <= cursor) continue;
    tiers.push({ basisCents: tierEnd - cursor, rateBps: rateBps + (selfSourced ? 100n : 0n) });
    cursor = tierEnd;
  }

  const weightedBasis = tiers.reduce((sum, tier) => sum + tier.basisCents * tier.rateBps, 0n);
  return { tiers, amountCents: roundWeightedBasis(weightedBasis) };
}

export function evaluateInstallmentRelease(input: {
  d0On: string;
  evaluatedOn: string;
  acvCents: bigint;
  active: boolean;
  hasOverdueBalance: boolean;
  settlements: readonly { settledOn: string; netCents: bigint; upfrontNetCents: bigint }[];
  commissionCents: bigint;
  paidCents: bigint;
  openCents: bigint;
}) {
  const cutoffOn = addLocalDays(input.d0On, 30);
  let netCents = 0n;
  let upfrontNetCents = 0n;
  for (const settlement of input.settlements) {
    if (settlement.settledOn > input.evaluatedOn) continue;
    netCents += settlement.netCents;
    if (settlement.settledOn <= cutoffOn) upfrontNetCents += settlement.upfrontNetCents;
  }

  const milestoneOn = addLocalDays(input.d0On, upfrontNetCents * 4n >= input.acvCents ? 90 : 120);
  const availableCents = input.commissionCents - input.paidCents - input.openCents;
  const meetsConditions = input.acvCents > 0n && input.evaluatedOn >= milestoneOn &&
    input.active && !input.hasOverdueBalance && netCents * 3n >= input.acvCents;

  return {
    milestoneOn,
    upfrontNetCents,
    netCents,
    meetsConditions,
    releasableCents: meetsConditions && availableCents > 0n ? availableCents : 0n,
  };
}

export function firstFifthBusinessDateOnOrAfter(localDate: string, holidays: ReadonlySet<string>) {
  let date = `${localDate.slice(0, 7)}-01`;
  let month = date.slice(0, 7);
  let businessDays = 0;
  while (true) {
    const dateMonth = date.slice(0, 7);
    if (dateMonth !== month) {
      month = dateMonth;
      businessDays = 0;
    }
    if (isBusinessDate(date, holidays)) {
      businessDays++;
      if (businessDays === 5 && date >= localDate) return date;
    }
    date = addLocalDays(date, 1);
  }
}
