import { z } from "zod";

const id = z.string().uuid();
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const cents = z.coerce.bigint().positive();
const idempotencyKey = text(8, 180);

export const financeQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict().superRefine((value, context) => {
  if (value.from && value.to && value.to <= value.from) {
    context.addIssue({ code: "custom", path: ["to"], message: "O fim deve ser posterior ao início." });
  }
  if (value.from && value.to && value.to.getTime() - value.from.getTime() > 366 * 86_400_000) {
    context.addIssue({ code: "custom", path: ["to"], message: "Consulte até 366 dias por vez." });
  }
});

export const createFinancialCategorySchema = z.object({
  action: z.literal("CREATE_CATEGORY"),
  key: text(2, 80).regex(/^[a-z][a-z0-9_]*$/),
  name: text(2, 120),
  kind: z.enum(["INCOME", "EXPENSE"]),
  dreGroup: text(2, 120).nullable().default(null),
}).strict();

export const createFinancialAccountSchema = z.object({
  action: z.literal("CREATE_ACCOUNT"),
  name: text(2, 120),
  type: z.enum(["CASH", "BANK", "OTHER"]),
  openingBalanceCents: z.coerce.bigint().default(0n),
}).strict();

export const createFinancialEntrySchema = z.object({
  action: z.literal("CREATE_ENTRY"),
  categoryId: id,
  financialAccountId: id,
  customerAccountId: id.nullable().default(null),
  direction: z.enum(["INCOME", "EXPENSE"]),
  status: z.enum(["PLANNED", "SETTLED"]).default("PLANNED"),
  description: text(3, 240),
  counterparty: text(2, 160).nullable().default(null),
  amountCents: cents,
  competenceAt: z.coerce.date(),
  dueAt: z.coerce.date(),
  settledAt: z.coerce.date().nullable().default(null),
  idempotencyKey,
}).strict().superRefine((value, context) => {
  if (value.status === "SETTLED" && !value.settledAt) {
    context.addIssue({ code: "custom", path: ["settledAt"], message: "Informe a data de realização." });
  }
  if (value.status === "PLANNED" && value.settledAt) {
    context.addIssue({ code: "custom", path: ["settledAt"], message: "Lançamento previsto não possui data de realização." });
  }
});

export const settleFinancialEntrySchema = z.discriminatedUnion("status", [
  z.object({
    action: z.literal("SETTLE_ENTRY"),
    entryId: id,
    status: z.literal("SETTLED"),
    settledAt: z.coerce.date(),
    expectedRevision: z.number().int().positive(),
  }).strict(),
  z.object({
    action: z.literal("SETTLE_ENTRY"),
    entryId: id,
    status: z.literal("CANCELLED"),
    reason: text(8, 500),
    expectedRevision: z.number().int().positive(),
  }).strict(),
]);

export const createCommissionRuleSchema = z.object({
  action: z.literal("CREATE_COMMISSION_RULE"),
  sellerMemberId: id,
  percentageBps: z.number().int().min(0).max(10_000),
  effectiveFrom: z.coerce.date(),
}).strict();

export const updateCommissionSchema = z.object({
  action: z.literal("UPDATE_COMMISSION"),
  commissionId: id,
  status: z.enum(["APPROVED", "PAID"]),
  expectedRevision: z.number().int().positive(),
  financialAccountId: id.optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "PAID" && !value.financialAccountId) {
    context.addIssue({ code: "custom", path: ["financialAccountId"], message: "Selecione a conta usada no pagamento da comissão." });
  }
});

export const reconcileCommissionsSchema = z.object({
  action: z.literal("RECONCILE_COMMISSIONS"),
  through: z.coerce.date().optional(),
}).strict();

export const financeCommandSchema = z.discriminatedUnion("action", [
  createFinancialCategorySchema,
  createFinancialAccountSchema,
  createFinancialEntrySchema,
  z.object({ action: z.literal("SETTLE_ENTRY"), entryId: id, status: z.enum(["SETTLED", "CANCELLED"]), settledAt: z.coerce.date().optional(), reason: text(8, 500).optional(), expectedRevision: z.number().int().positive() }).strict(),
  createCommissionRuleSchema,
  updateCommissionSchema,
  reconcileCommissionsSchema,
]);

export function commissionAmountCents(basisCents: bigint, percentageBps: number) {
  if (basisCents < 0n) throw new Error("A base da comissão não pode ser negativa.");
  if (!Number.isInteger(percentageBps) || percentageBps < 0 || percentageBps > 10_000) throw new Error("Percentual de comissão inválido.");
  return (basisCents * BigInt(percentageBps) + 5_000n) / 10_000n;
}

export function nextCommissionStatus(current: "PENDING" | "APPROVED" | "PAID", requested: "APPROVED" | "PAID") {
  if (current === "PENDING" && requested === "APPROVED") return "APPROVED" as const;
  if (current === "APPROVED" && requested === "PAID") return "PAID" as const;
  return null;
}

export type FinanceCommand = z.infer<typeof financeCommandSchema>;
