import { z } from "zod";

const cents = z.string().regex(/^\d{1,15}$/).refine((value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER), "Valor fora do limite seguro.");
const terms = z.object({
  opportunityId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  sellerMemberId: z.string().uuid(),
  totalCents: cents.refine((value) => BigInt(value) > 0n),
  monthlyCents: cents,
  upfrontCents: cents.default("0"),
  durationMonths: z.number().int().min(1).max(60),
  startsAt: z.string().datetime({ offset: true }),
  templateVersionId: z.string().uuid(),
  customer: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("CREATE"), name: z.string().trim().min(2).max(200) }).strict(),
    z.object({ mode: z.literal("LINK"), accountId: z.string().uuid() }).strict(),
  ]).optional(),
  acceptance: z.object({
    acceptedByName: z.string().trim().min(2).max(200),
    acceptedByRole: z.string().trim().min(2).max(200),
    evidenceText: z.string().trim().min(5).max(2000),
  }).strict().optional(),
  onboardingOwnerMemberId: z.string().uuid().optional(),
}).strict();

function consistent(input: z.infer<typeof terms>, ctx: z.RefinementCtx) {
  if (BigInt(input.totalCents) !== BigInt(input.upfrontCents) + BigInt(input.monthlyCents) * BigInt(input.durationMonths)) {
    ctx.addIssue({ code: "custom", path: ["totalCents"], message: "Total deve ser igual à entrada mais mensalidade × meses. Informe a diferença explicitamente." });
  }
  if (BigInt(input.monthlyCents) === 0n && input.durationMonths !== 1) {
    ctx.addIssue({ code: "custom", path: ["durationMonths"], message: "Venda avulsa deve ter uma única parcela." });
  }
  if (input.onboardingOwnerMemberId && !input.acceptance) {
    ctx.addIssue({ code: "custom", path: ["acceptance"], message: "O onboarding exige evidência do aceite contratual." });
  }
}

export const saleCompletionSchema = terms.superRefine(consistent);
export const executeSaleCompletionSchema = terms.extend({ confirmed: z.literal(true), idempotencyKey: z.string().uuid() }).superRefine(consistent);
export type SaleCompletionInput = z.infer<typeof saleCompletionSchema>;

// Anchor every installment to the original day: Jan 31 → Feb 28 → Mar 31.
export function saleMonth(at: string, months: number): Date {
  const result = new Date(at);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function saleSchedule(input: SaleCompletionInput) {
  return Array.from({ length: input.durationMonths }, (_, index) => ({
    installment: index + 1,
    amountCents: (BigInt(input.monthlyCents) + (index === 0 ? BigInt(input.upfrontCents) : 0n)).toString(),
    dueAt: saleMonth(input.startsAt, index).toISOString(),
    periodEnd: saleMonth(input.startsAt, index + 1).toISOString(),
  }));
}
