import type { IntegratedActivityFact } from "@/modules/metrics/domain/metrics-contracts";
import type { RealtimeSalesFunnel, RealtimeDashboardTotals } from "./realtime-dashboard-contracts";

const workedEvents = new Set([
  "TASK_COMPLETED", "CALL_ATTEMPTED", "CALL_CONNECTED", "INBOUND_MESSAGE_RECEIVED",
  "WHATSAPP_MESSAGE_SENT", "INSTAGRAM_MESSAGE_SENT", "EMAIL_SENT",
  "MEETING_SCHEDULED", "MEETING_COMPLETED", "SALE_WON",
]);

export function buildRealtimeSalesFunnel(facts: readonly IntegratedActivityFact[], totals: RealtimeDashboardTotals, leadsReceived?: number): RealtimeSalesFunnel {
  const balances = new Map<string, { leadId: string; quantity: number }>();
  for (const fact of facts) {
    if (!fact.leadId || !workedEvents.has(fact.eventType)) continue;
    const key = `${fact.eventType}:${fact.leadId}`;
    balances.set(key, { leadId: fact.leadId, quantity: (balances.get(key)?.quantity ?? 0) + fact.quantity });
  }
  const leadsWorked = new Set([...balances.values()].filter(row => row.quantity > 0).map(row => row.leadId)).size;
  // These are period-volume ratios, not a cohort or a promise that all meetings share a booking week.
  const rate = (numerator: number, denominator: number) => denominator > 0 ? Math.round(numerator * 10_000 / denominator) : null;
  return Object.freeze({
    leadsWorked, meetingsScheduled: totals.meetingsScheduled, meetingsCompleted: totals.meetingsCompleted,
    sales: totals.sales, salesValueCents: totals.salesValueCents,
    scheduledRateBasisPoints: rate(totals.meetingsScheduled, leadsReceived ?? leadsWorked),
    completedRateBasisPoints: rate(totals.meetingsCompleted, totals.meetingsScheduled),
    salesRateBasisPoints: rate(totals.sales, totals.meetingsCompleted),
  });
}
