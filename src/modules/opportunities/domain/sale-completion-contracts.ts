import { z } from "zod";

export const salePaymentMethods = ["PIX", "BANK_TRANSFER", "CARD", "CASH", "OTHER"] as const;
export const salePaymentPlans = ["CASH", "INSTALLMENTS", "UPFRONT_INSTALLMENTS"] as const;

const cents = z.string().regex(/^\d{1,15}$/).refine((value) => /^\d{1,15}$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER), "Valor fora do limite seguro.");
export const directSalePaymentPlans = ["UPFRONT_INSTALLMENTS", "CASH", "CARD_INSTALLMENTS"] as const;

export function directSaleInstallmentCount(input: { totalCents: string; upfrontCents: string; installmentCents: string; paymentPlan: (typeof directSalePaymentPlans)[number] }): number | null {
  if (![input.totalCents, input.upfrontCents, input.installmentCents].every((value) => /^\d{1,15}$/.test(value))) return null;
  const total = BigInt(input.totalCents);
  const upfront = BigInt(input.upfrontCents);
  const installment = BigInt(input.installmentCents);
  if (total <= 0n || upfront > total) return null;
  if (input.paymentPlan === "CASH") return upfront === total && installment === 0n ? 1 : null;
  const balance = total - upfront;
  if (installment <= 0n || balance <= 0n || balance % installment !== 0n) return null;
  const count = balance / installment;
  return count >= 1n && count <= 60n ? Number(count) : null;
}

export const completeLeadSaleSchema = z.object({
  leadId: z.string().uuid(),
  opportunityId: z.string().uuid().optional(),
  expectedRevision: z.number().int().positive().optional(),
  sellerMemberId: z.string().uuid(),
  totalCents: cents,
  paymentPlan: z.enum(directSalePaymentPlans),
  installmentCents: cents,
  upfrontCents: cents,
  paymentCondition: z.string().trim().min(2).max(500),
  confirmed: z.literal(true),
  idempotencyKey: z.string().uuid(),
}).strict().superRefine((input, ctx) => {
  if (Boolean(input.opportunityId) !== Boolean(input.expectedRevision)) ctx.addIssue({ code: "custom", path: ["opportunityId"], message: "Recarregue os dados do negócio antes de fechar." });
  if (directSaleInstallmentCount(input) === null) ctx.addIssue({ code: "custom", path: ["totalCents"], message: input.paymentPlan === "CASH"
    ? "À vista exige entrada igual ao total e parcela zero."
    : "O saldo após a entrada deve corresponder a 1 até 60 parcelas inteiras do valor informado." });
});
export const completeLeadSaleResultSchema = z.object({
  opportunityId: z.string().uuid(), accountId: z.string().uuid(), contractId: z.string().uuid(),
  invoiceIds: z.array(z.string().uuid()), receivedCents: z.literal("0"), outstandingCents: cents, replayed: z.boolean(),
});
export type CompleteLeadSaleResult = z.infer<typeof completeLeadSaleResultSchema>;
const terms = z.object({
  opportunityId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  sellerMemberId: z.string().uuid(),
  totalCents: cents.refine((value) => BigInt(value) > 0n),
  monthlyCents: cents,
  upfrontCents: cents.default("0"),
  receivedCents: cents.default("0"),
  paymentMethod: z.enum(salePaymentMethods),
  paymentCondition: z.string().trim().min(2).max(500),
  financialAccountId: z.string().uuid().optional(),
  receivedAt: z.string().datetime({ offset: true }).optional(),
  paymentReference: z.string().trim().min(3).max(180).optional(),
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
  }).strict(),
  onboardingOwnerMemberId: z.string().uuid().optional(),
}).strict();

function consistent(input: z.infer<typeof terms>, ctx: z.RefinementCtx) {
  if (BigInt(input.totalCents) !== BigInt(input.upfrontCents) + BigInt(input.monthlyCents) * BigInt(input.durationMonths)) {
    ctx.addIssue({ code: "custom", path: ["totalCents"], message: "Total deve ser igual à entrada mais mensalidade × meses. Informe a diferença explicitamente." });
  }
  if (BigInt(input.monthlyCents) === 0n && input.durationMonths !== 1) {
    ctx.addIssue({ code: "custom", path: ["durationMonths"], message: "Venda avulsa deve ter uma única parcela." });
  }
  if (BigInt(input.receivedCents) > BigInt(input.totalCents)) {
    ctx.addIssue({ code: "custom", path: ["receivedCents"], message: "O valor recebido não pode superar o total da venda." });
  }
  if (BigInt(input.receivedCents) > 0n) {
    if (!input.financialAccountId) ctx.addIssue({ code: "custom", path: ["financialAccountId"], message: "Selecione a conta que recebeu o valor." });
    if (!input.receivedAt) ctx.addIssue({ code: "custom", path: ["receivedAt"], message: "Informe a data do recebimento." });
    if (!input.paymentReference) ctx.addIssue({ code: "custom", path: ["paymentReference"], message: "Informe uma referência do recebimento." });
  }
}

export const saleCompletionSchema = terms.superRefine(consistent);
export const executeSaleCompletionSchema = terms.extend({ confirmed: z.literal(true), idempotencyKey: z.string().uuid() }).superRefine(consistent);
export type SaleCompletionInput = z.infer<typeof saleCompletionSchema>;

const prepareLeadSaleTerms = z.object({
  leadId: z.string().uuid(),
  sellerMemberId: z.string().uuid(),
  productId: z.string().uuid(),
  description: z.string().trim().min(3).max(2_000),
  paymentPlan: z.enum(salePaymentPlans),
  paymentMethod: z.enum(salePaymentMethods),
  totalCents: cents.refine((value) => BigInt(value) > 0n),
  upfrontCents: cents.default("0"),
  installmentCents: cents.default("0"),
  installmentCount: z.number().int().min(1).max(60),
  idempotencyKey: z.string().uuid(),
}).strict();

export const prepareLeadSaleSchema = prepareLeadSaleTerms.superRefine((input, ctx) => {
  const total = BigInt(input.totalCents);
  const upfront = BigInt(input.upfrontCents);
  const installments = BigInt(input.installmentCents) * BigInt(input.installmentCount);
  if (input.paymentPlan === "CASH" && (upfront !== total || BigInt(input.installmentCents) !== 0n || input.installmentCount !== 1)) {
    ctx.addIssue({ code: "custom", path: ["totalCents"], message: "À vista exige entrada igual ao valor total, sem parcelas." });
  }
  if (input.paymentPlan === "INSTALLMENTS" && (upfront !== 0n || installments !== total)) {
    ctx.addIssue({ code: "custom", path: ["totalCents"], message: "No parcelamento sem entrada, o total deve ser igual ao número de parcelas × valor da parcela." });
  }
  if (input.paymentPlan === "UPFRONT_INSTALLMENTS" && (upfront <= 0n || installments <= 0n || upfront + installments !== total)) {
    ctx.addIssue({ code: "custom", path: ["totalCents"], message: "O total deve ser igual à entrada mais o número de parcelas × valor da parcela." });
  }
});
export type PrepareLeadSaleInput = z.infer<typeof prepareLeadSaleSchema>;

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
