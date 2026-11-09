import { nextBusinessDate } from "@/modules/prospecting/domain/prospecting-cadence";
import { addLocalDays } from "@/shared/core/time/workspace-time";

export const legacyStageDays = [30, 60, 90] as const;
export const pendingLegacyPaymentAllocation = "Pagamento informado. Aguardando o valor pago e a distribuição entre as etapas.";
export type LegacyStageDay = typeof legacyStageDays[number];

export function projectLegacyCompensation(input: {
  acvCents: bigint;
  d0On: string | null;
  holidays: ReadonlySet<string>;
  verifiedThroughOn: string | null;
  possiblyPaidStages: ReadonlySet<LegacyStageDay>;
  allocations: ReadonlyMap<LegacyStageDay, bigint>;
}) {
  const total = (input.acvCents * 600n + 5000n) / 10000n;
  const first = (total * 3500n + 5000n) / 10000n;
  const second = (total * 3000n + 5000n) / 10000n;
  const amounts = [first, second, total - first - second];
  return legacyStageDays.map((days, index) => {
    const amountCents = amounts[index]!;
    const paidCents = input.allocations.get(days) ?? 0n;
    if (amountCents <= 0n || paidCents < 0n || paidCents > amountCents) {
      throw new RangeError("Alocação ou valor de etapa histórica incompatível.");
    }
    const milestoneOn = input.d0On ? addLocalDays(input.d0On, days) : null;
    const candidateDueOn = milestoneOn && input.verifiedThroughOn ? nextBusinessDate(milestoneOn, input.holidays) : null;
    const dueOn = candidateDueOn && input.verifiedThroughOn && candidateDueOn <= input.verifiedThroughOn ? candidateDueOn : null;
    const balanceCents = amountCents - paidCents;
    const reason = !balanceCents ? null : input.possiblyPaidStages.has(days)
      ? pendingLegacyPaymentAllocation
      : !milestoneOn ? "Aceite, ativação ou primeira liquidação histórica sem comprovação."
        : !dueOn ? "Calendário histórico sem cobertura verificada." : null;
    return { days, amountCents, paidCents, balanceCents, milestoneOn, dueOn, reason };
  });
}
