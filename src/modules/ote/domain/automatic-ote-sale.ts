import { z } from "zod";
import type { SaleKind } from "./ote-calculator";

type Sale = {
  amountCents: bigint; mrrCents: bigint; tcvCents: bigint; farmerExpansionSignalId?: string | null;
  product?: { sku: string; kind: string; revenueCategory: string } | null;
};
type Version = { totalCents: bigint; mrrCents: bigint; durationMonths: number | null; billingFrequency: string; paymentTerms: string };
export type OteSaleTerms = { totalCents: string; upfrontCents: string | null; installmentCents: string | null; installmentCount: number | null; paymentCondition: string | null };

export function automaticOteSale(sale: Sale, version?: Version) {
  const total = sale.tcvCents > 0n ? sale.tcvCents : sale.amountCents;
  const mrr = sale.mrrCents;
  let kind: SaleKind;
  if (sale.farmerExpansionSignalId) kind = "EXPANSION";
  else if (sale.product && ["PROJECT", "IMPLEMENTATION"].includes(sale.product.revenueCategory)) kind = "PROJECT";
  else if (!sale.product || !["SOFTWARE", "RECURRING_SERVICE"].includes(sale.product.revenueCategory)) return null;
  else if (version && ["ONE_TIME", "ANNUAL"].includes(version.billingFrequency)) kind = "ANNUAL_UPFRONT";
  else if (mrr > 0n) kind = "ANNUAL_MONTHLY";
  else return null;
  // Direct Politizai sales record the negotiated license price independently of
  // the number of payment installments. An entry is part of that price, not cash.
  const acvCents = kind === "PROJECT" ? 0n : kind === "EXPANSION" ? (mrr > 0n ? mrr * 12n : total) : sale.product?.sku === "SISTEMA-POLITIZAI" ? total : mrr > 0n ? mrr * 12n : total;
  return { kind, acvCents, selfSourced: false, source: "AUTOMATIC" as const };
}

const cents = z.string().regex(/^\d{1,15}$/);
const termsSchema = z.object({ totalCents: cents, upfrontCents: cents, monthlyCents: cents,
  durationMonths: z.number().int().min(1).max(60), paymentCondition: z.string().max(500),
}).refine((v) => BigInt(v.totalCents) === BigInt(v.upfrontCents) + BigInt(v.monthlyCents) * BigInt(v.durationMonths));

export function oteSaleTerms(sale: Sale, version?: Version, snapshot?: unknown): OteSaleTerms {
  const parsed = termsSchema.safeParse(snapshot);
  if (parsed.success) return { totalCents: parsed.data.totalCents, upfrontCents: parsed.data.upfrontCents,
    installmentCents: parsed.data.monthlyCents, installmentCount: parsed.data.durationMonths, paymentCondition: parsed.data.paymentCondition };
  const count = version?.durationMonths ?? null;
  const upfront = version && count !== null ? version.totalCents - version.mrrCents * BigInt(count) : null;
  return { totalCents: (version?.totalCents ?? (sale.tcvCents > 0n ? sale.tcvCents : sale.amountCents)).toString(),
    upfrontCents: upfront !== null && upfront >= 0n ? upfront.toString() : null,
    installmentCents: version?.mrrCents.toString() ?? null, installmentCount: count,
    paymentCondition: version?.paymentTerms ?? null };
}
