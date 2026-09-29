import { z } from "zod";

export const billingIntervalSchema = z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]);
export const createSubscriptionSchema = z.object({ contractId: z.string().uuid(), quantity: z.number().int().positive(), recurringPriceCents: z.coerce.bigint().nonnegative(), billingInterval: billingIntervalSchema, startsAt: z.coerce.date(), endsAt: z.coerce.date().nullable().default(null) });
export const subscriptionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ACTIVATE"), effectiveAt: z.coerce.date(), reason: z.string().min(3), idempotencyKey: z.string().min(8) }),
  z.object({ action: z.literal("SCHEDULE_CHANGE"), effectiveAt: z.coerce.date(), quantity: z.number().int().positive(), recurringPriceCents: z.coerce.bigint().nonnegative(), billingInterval: billingIntervalSchema, reason: z.string().min(3) }),
  z.object({ action: z.literal("APPLY_CHANGE"), changeId: z.string().uuid(), idempotencyKey: z.string().min(8) }),
  z.object({ action: z.literal("RENEW"), effectiveAt: z.coerce.date(), reason: z.string().min(3), idempotencyKey: z.string().min(8) }),
  z.object({ action: z.literal("SCHEDULE_CANCELLATION"), effectiveAt: z.coerce.date(), reason: z.string().min(3) }),
  z.object({ action: z.literal("CHURN"), effectiveAt: z.coerce.date(), reason: z.string().min(3), idempotencyKey: z.string().min(8) }),
  z.object({ action: z.literal("REACTIVATE"), effectiveAt: z.coerce.date(), reason: z.string().min(3), idempotencyKey: z.string().min(8) }),
  z.object({ action: z.literal("REVERSE"), movementId: z.string().uuid(), reason: z.string().min(3), idempotencyKey: z.string().min(8), replacement: z.object({ type: z.enum(["NEW","EXPANSION","CONTRACTION","RENEWAL","CHURN","REACTIVATION"]), deltaMrrCents: z.coerce.bigint(), effectiveAt: z.coerce.date() }).optional() }),
]);

export function normalizedMrr(quantity: number, recurringPriceCents: bigint, interval: z.infer<typeof billingIntervalSchema>) {
  const total = BigInt(quantity) * recurringPriceCents;
  const divisor = interval === "MONTHLY" ? 1n : interval === "QUARTERLY" ? 3n : 12n;
  return (total + divisor / 2n) / divisor;
}

export function reconstructMrr(movements: readonly { deltaMrrCents: bigint; effectiveAt: Date; sequence: number }[], cutoff: Date) {
  return movements.filter((m) => m.effectiveAt <= cutoff).sort((a,b) => a.effectiveAt.getTime()-b.effectiveAt.getTime() || a.sequence-b.sequence).reduce((sum,m) => sum + m.deltaMrrCents, 0n);
}
