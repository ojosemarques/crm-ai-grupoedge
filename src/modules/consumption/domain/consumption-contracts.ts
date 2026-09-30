import { z } from "zod";

export const consumptionResourceTypeSchema = z.enum(["AI", "SMS", "VOICE", "PROVIDER"]);
export type ConsumptionResourceType = z.infer<typeof consumptionResourceTypeSchema>;

const bigintValue = z.union([z.bigint(), z.number().int().safe(), z.string().regex(/^\d+$/)]).transform(BigInt);
const nullableBigintValue = bigintValue.nullable().default(null);

export const configureConsumptionBudgetSchema = z
  .object({
    resourceType: consumptionResourceTypeSchema,
    resourceKey: z.string().trim().min(2).max(120),
    currency: z.string().trim().length(3).default("BRL"),
    limitCents: nullableBigintValue,
    limitUnits: nullableBigintValue,
    includedCreditCents: bigintValue.default(0n),
    warningBasisPoints: z.number().int().min(1).max(10_000).default(8_000),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    status: z.enum(["ACTIVE", "PAUSED", "REVOKED"]).default("ACTIVE"),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.limitCents === null && value.limitUnits === null) {
      context.addIssue({ code: "custom", path: ["limitCents"], message: "Informe um teto monetário ou de unidades." });
    }
    if (value.periodStart >= value.periodEnd) {
      context.addIssue({ code: "custom", path: ["periodEnd"], message: "O fim do período deve ser posterior ao início." });
    }
  });

export const recordConsumptionSchema = z
  .object({
    resourceType: consumptionResourceTypeSchema,
    resourceKey: z.string().trim().min(2).max(120),
    amountCents: bigintValue.default(0n),
    units: bigintValue.default(0n),
    idempotencyKey: z.string().trim().min(8).max(160),
    externalReference: z.string().trim().min(1).max(200).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
    occurredAt: z.coerce.date().optional(),
  })
  .strict()
  .refine((value) => value.amountCents > 0n || value.units > 0n, {
    path: ["amountCents"],
    message: "Informe custo ou unidades consumidas.",
  });

export const grantConsumptionCreditSchema = z
  .object({
    budgetId: z.string().uuid(),
    amountCents: bigintValue,
    idempotencyKey: z.string().trim().min(8).max(160),
    externalReference: z.string().trim().min(1).max(200).optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .refine((value) => value.amountCents > 0n, { path: ["amountCents"], message: "O crédito deve ser positivo." });

export type ConsumptionDecision = Readonly<{
  allowed: boolean;
  code: "ALLOWED" | "BUDGET_NOT_CONFIGURED" | "BUDGET_PAUSED" | "BUDGET_REVOKED" | "MONEY_LIMIT_EXCEEDED" | "UNIT_LIMIT_EXCEEDED";
  shouldPause: boolean;
  spentCents: bigint;
  consumedUnits: bigint;
  availableCents: bigint | null;
  availableUnits: bigint | null;
  warning: boolean;
}>;

export function evaluateConsumption(input: Readonly<{
  status: "ACTIVE" | "PAUSED" | "REVOKED";
  limitCents: bigint | null;
  limitUnits: bigint | null;
  includedCreditCents: bigint;
  creditedCents: bigint;
  spentCents: bigint;
  consumedUnits: bigint;
  requestedAmountCents: bigint;
  requestedUnits: bigint;
  warningBasisPoints: number;
}>): ConsumptionDecision {
  const availableCents = input.limitCents === null
    ? null
    : input.limitCents + input.includedCreditCents + input.creditedCents - input.spentCents;
  const availableUnits = input.limitUnits === null ? null : input.limitUnits - input.consumedUnits;
  if (input.status === "REVOKED") return { allowed: false, code: "BUDGET_REVOKED", shouldPause: false, spentCents: input.spentCents, consumedUnits: input.consumedUnits, availableCents, availableUnits, warning: false };
  if (input.status === "PAUSED") return { allowed: false, code: "BUDGET_PAUSED", shouldPause: false, spentCents: input.spentCents, consumedUnits: input.consumedUnits, availableCents, availableUnits, warning: false };
  if (availableCents !== null && input.requestedAmountCents > availableCents) return { allowed: false, code: "MONEY_LIMIT_EXCEEDED", shouldPause: true, spentCents: input.spentCents, consumedUnits: input.consumedUnits, availableCents, availableUnits, warning: true };
  if (availableUnits !== null && input.requestedUnits > availableUnits) return { allowed: false, code: "UNIT_LIMIT_EXCEEDED", shouldPause: true, spentCents: input.spentCents, consumedUnits: input.consumedUnits, availableCents, availableUnits, warning: true };
  const projectedMoney = input.spentCents + input.requestedAmountCents;
  const moneyCapacity = input.limitCents === null ? null : input.limitCents + input.includedCreditCents + input.creditedCents;
  const projectedUnits = input.consumedUnits + input.requestedUnits;
  const moneyWarning = moneyCapacity !== null && moneyCapacity > 0n && projectedMoney * 10_000n >= moneyCapacity * BigInt(input.warningBasisPoints);
  const unitWarning = input.limitUnits !== null && input.limitUnits > 0n && projectedUnits * 10_000n >= input.limitUnits * BigInt(input.warningBasisPoints);
  return { allowed: true, code: "ALLOWED", shouldPause: false, spentCents: input.spentCents, consumedUnits: input.consumedUnits, availableCents, availableUnits, warning: moneyWarning || unitWarning };
}
