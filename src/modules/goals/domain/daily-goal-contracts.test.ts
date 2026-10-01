import { describe, expect, it } from "vitest";
import { buildDailyGoalProgress, dailyGoalInputSchema } from "./daily-goal-contracts";

describe("metas diárias por pessoa", () => {
  it("compara cada produção com seu alvo sem misturar contagem e dinheiro", () => {
    const progress = buildDailyGoalProgress(
      { calls: 25n, messages: 40n, effectiveContacts: 8n, qualifications: 5n, meetingsScheduled: 1n, proposals: 2n, salesValueCents: 50_000n },
      { calls: 50n, messages: 40n, effectiveContacts: 10n, qualifications: 5n, meetingsScheduled: 3n, proposals: 2n, salesValueCents: 100_000n },
    );
    expect(progress.completed).toBe(3);
    expect(progress.target).toBe(7);
    expect(progress.metrics.find((metric) => metric.key === "CALLS")).toMatchObject({ actualValue: "25", targetValue: "50", remainingValue: "25", progressPercent: 50, achieved: false });
    expect(progress.metrics.find((metric) => metric.key === "SALES_VALUE_CENTS")).toMatchObject({ actualValue: "50000", targetValue: "100000", remainingValue: "50000", progressPercent: 50 });
  });

  it("trata zero como métrica desativada e valida limites", () => {
    const progress = buildDailyGoalProgress(
      { calls: 4n, messages: 0n, effectiveContacts: 0n, qualifications: 0n, meetingsScheduled: 0n, proposals: 0n, salesValueCents: 0n },
      { calls: 5n, messages: 0n, effectiveContacts: 0n, qualifications: 0n, meetingsScheduled: 0n, proposals: 0n, salesValueCents: 0n },
    );
    expect(progress.target).toBe(1);
    expect(progress.progressPercent).toBe(80);
    expect(dailyGoalInputSchema.safeParse({ memberId: crypto.randomUUID(), expectedRevision: null, callsTarget: -1, messagesTarget: 0, effectiveContactsTarget: 0, qualificationsTarget: 0, meetingsScheduledTarget: 0, proposalsTarget: 0, salesValueTargetCents: "0" }).success).toBe(false);
  });
});
