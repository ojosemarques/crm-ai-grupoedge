import { z } from "zod";

export const saleKinds = ["ANNUAL_MONTHLY", "ANNUAL_UPFRONT", "PROJECT", "EXPANSION", "RENEWAL", "AUTO_RENEWAL", "LOW_TICKET"] as const;
export type SaleKind = typeof saleKinds[number];
export const saleKindLabels: Record<SaleKind, string> = {
  ANNUAL_MONTHLY: "Anual pago mensalmente", ANNUAL_UPFRONT: "Anual antecipado / à vista",
  PROJECT: "Campanha / projeto pontual", EXPANSION: "Expansão / upgrade",
  RENEWAL: "Renovação negociada", AUTO_RENEWAL: "Renovação automática", LOW_TICKET: "Low-ticket automático",
};
const cents = z.string().regex(/^\d{1,12}$/);
export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const oteQuerySchema = z.object({ month: monthSchema.optional() }).strict();
export const oteCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SAVE_PLAN"), memberId: z.string().uuid(), effectiveMonth: monthSchema,
    label: z.string().trim().min(2).max(100), role: z.enum(["CLOSER", "SDR"]), fixedCents: cents,
    quotaCents: cents, bonusCents: cents, meetingQuota: z.number().int().min(1).max(1000),
    salesQuota: z.number().int().min(1).max(1000), expectedRevision: z.number().int().min(0),
  }).strict().refine((v) => v.role === "SDR" || BigInt(v.quotaCents) > 0n, "Informe a meta ACV."),
  z.object({ action: z.literal("CLASSIFY_SALE"), opportunityId: z.string().uuid(), kind: z.enum(saleKinds),
    acvCents: cents, selfSourced: z.boolean(), sdrMemberId: z.string().uuid().nullable(),
    evidence: z.string().trim().min(5).max(1000), expectedRevision: z.number().int().min(0),
  }).strict(),
  z.object({ action: z.literal("QUALIFY_MEETING"), meetingId: z.string().uuid(), sdrMemberId: z.string().uuid(),
    qualified: z.boolean(), evidence: z.string().trim().min(5).max(1000), expectedRevision: z.number().int().min(0),
  }).strict(),
]);

export type OtePlanValues = { role: string; fixedCents: bigint; quotaCents: bigint; bonusCents: bigint; meetingQuota: number; salesQuota: number };
export function expectedOte(plan: OtePlanValues): bigint {
  return plan.fixedCents + (plan.role === "SDR" ? BigInt(plan.meetingQuota) * 4000n + BigInt(plan.salesQuota) * 10000n : percent(plan.quotaCents, 600) + plan.bonusCents);
}
export const percent = (cents: bigint, bps: number) => (cents * BigInt(bps) + 5000n) / 10000n;
const min = (a: bigint, b: bigint) => a < b ? a : b;
const max = (a: bigint, b: bigint) => a > b ? a : b;
export function isNewAcv(kind: string) { return kind === "ANNUAL_MONTHLY" || kind === "ANNUAL_UPFRONT"; }

export function calculateSale(input: { kind: string; acvCents: bigint; receivedCents: bigint; selfSourced: boolean; priorNewAcvCents: bigint; quotaCents: bigint }) {
  const { kind, acvCents: acv, receivedCents: received, priorNewAcvCents: prior, quotaCents: quota } = input;
  const extra = input.selfSourced && !["AUTO_RENEWAL", "LOW_TICKET"].includes(kind) ? 100 : 0;
  if (kind === "ANNUAL_MONTHLY") {
    const tier1 = min(acv, max(0n, quota - prior));
    const tier2 = min(acv - tier1, max(0n, quota * 125n / 100n - max(prior, quota)));
    const tier3 = acv - tier1 - tier2;
    const commission = percent(tier1, 600 + extra) + percent(tier2, 800 + extra) + percent(tier3, 1000 + extra);
    const rates = [[tier1, 6], [tier2, 8], [tier3, 10]] as const;
    const applied = rates.filter(([base]) => base > 0n).map(([, rate]) => `${rate + extra / 100}%`);
    return { projectedCents: commission, receiptCommissionCents: commission, rate: `${applied.join(" / ") || `${6 + extra / 100}%`}${applied.length > 1 ? " por faixa" : " do ACV"}` };
  }
  if (kind === "ANNUAL_UPFRONT") return { projectedCents: percent(received, 800 + extra), receiptCommissionCents: percent(received, 800 + extra), rate: `${8 + extra / 100}% do recebido` };
  if (kind === "PROJECT") return { projectedCents: percent(received, 500 + extra), receiptCommissionCents: percent(received, 500 + extra), rate: `${5 + extra / 100}% do recebido` };
  const bps = kind === "EXPANSION" ? 500 + extra : kind === "RENEWAL" ? 200 + extra : 0;
  return { projectedCents: percent(acv, bps), receiptCommissionCents: percent(acv, bps), rate: `${bps / 100}% do ACV${kind === "EXPANSION" ? " incremental" : ""}` };
}

// Dates are provided by the service in the workspace timezone, not browser time.
export function releaseSchedule(commissionCents: bigint, dates: readonly Date[], now: Date, eligible: boolean) {
  const first = percent(commissionCents, 3500);
  const second = percent(commissionCents, 3000);
  return dates.map((date, index) => ({ date: date.toISOString(), amountCents: [first, second, commissionCents - first - second][index]!.toString(), eligible: eligible && date <= now }));
}
