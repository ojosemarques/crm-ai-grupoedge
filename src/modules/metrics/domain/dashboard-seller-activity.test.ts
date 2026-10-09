import { describe, expect, it } from "vitest";

import { mergeIntegratedActivitySeries } from "@/modules/metrics/domain/dashboard-series";
import { summarizeDashboardSellerActivity } from "@/modules/metrics/domain/dashboard-seller-activity";
import type { DashboardTimeSeries } from "@/modules/metrics/domain/dashboard-contracts";
import type { IntegratedActivityFact } from "@/modules/metrics/domain/metrics-contracts";

const memberId = "seller-1";
const from = "2026-10-09T00:00:00.000Z";
const to = "2026-10-10T00:00:00.000Z";
function fact(eventType: string, options: Partial<IntegratedActivityFact> = {}): IntegratedActivityFact {
  return { id: crypto.randomUUID(), eventType, sourceEntityType: "Task", occurredAt: from,
    leadId: "lead-1", creditedMemberId: memberId, performedByMemberId: null, bookedByMemberId: null, taskKind: null,
    result: null, cadenceStepKey: null, quantity: 1, valueCents: null, ...options };
}
function series(id: string): DashboardTimeSeries {
  return { id, label: id, kind: id === "revenue" ? "MONEY" : "COUNT", granularity: "DAY", aggregation: "SUM", formula: "anterior", drilldownId: `kpi.${id}`,
    points: [{ bucket: "2026-10-09", from, to, value: 0, numerator: 0, denominator: null }] };
}

describe("atividade integrada do dashboard", () => {
  it("separa reunião criada de card marcado e detalha a execução do vendedor", () => {
    const facts = [
      fact("TASK_COMPLETED"), fact("CALL_ATTEMPTED"),
      fact("CALL_UNANSWERED", { result: "NO_ANSWER" }),
      fact("STAGE_ENTERED", { sourceEntityType: "StageHistory", performedByMemberId: memberId }),
      fact("INSTAGRAM_MESSAGE_SENT", { sourceEntityType: "MessageStatusEvent" }),
      fact("INSTAGRAM_FOLLOW_COMPLETED"),
      fact("MEETING_SCHEDULED", { sourceEntityType: "StageHistory", bookedByMemberId: memberId }),
      fact("MEETING_SCHEDULED", { sourceEntityType: "MeetingHistory", bookedByMemberId: memberId }),
      fact("PROPOSAL_REACHED", { sourceEntityType: "Offer" }),
      fact("PROPOSAL_REACHED", { sourceEntityType: "StageHistory" }),
    ];
    expect(summarizeDashboardSellerActivity(facts, [{ id: memberId, name: "Vendedor" }])[0]).toMatchObject({
      tasksCompleted: 1, stageEntries: 1, calls: 1, noAnswer: 1, instagramMessages: 1, instagramFollows: 1,
      meetingsScheduled: 1, meetingStageMarked: 1, proposals: 1,
    });
    expect(mergeIntegratedActivitySeries([series("scheduled")], facts)[0]?.points[0]?.value).toBe(1);
  });

  it("conta leads conectados uma vez no período e soma vendas reais", () => {
    const facts = [
      fact("CALL_CONNECTED"), fact("CALL_CONNECTED"),
      fact("SALE_WON", { valueCents: "12000" }),
    ];
    const merged = mergeIntegratedActivitySeries([series("connected"), series("sales"), series("revenue")], facts);
    expect(merged.map((item) => item.points[0]?.value)).toEqual([1, 1, "12000"]);
    expect(summarizeDashboardSellerActivity(facts, [{ id: memberId, name: "Vendedor" }])[0]?.effectiveContacts).toBe(1);
  });

  it("respeita correções compensatórias de conexões", () => {
    const merged = mergeIntegratedActivitySeries(
      [series("connected")],
      [fact("CALL_CONNECTED"), fact("CALL_CONNECTED", { quantity: -1 })],
    );
    expect(merged[0]?.points[0]?.value).toBe(0);
  });

  it("posiciona uma nova qualificação após estornar o marco original", () => {
    const days = ["2026-10-09", "2026-10-10", "2026-10-11"];
    const timeSeries = { ...series("qualified"), points: days.map((day) => ({
      bucket: day, from: `${day}T00:00:00.000Z`, to: new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString(), value: 0, numerator: 0, denominator: null,
    })) };
    const merged = mergeIntegratedActivitySeries([timeSeries], [
      fact("LEAD_QUALIFIED", { occurredAt: "2026-10-09T12:00:00.000Z" }),
      fact("LEAD_QUALIFIED", { occurredAt: "2026-10-09T12:00:00.000Z", quantity: -1 }),
      fact("LEAD_QUALIFIED", { occurredAt: "2026-10-11T12:00:00.000Z" }),
    ]);
    expect(merged[0]?.points.map((point) => point.value)).toEqual([0, 0, 1]);
  });

  it("conta cada lead qualificado uma vez por vendedor após correções", () => {
    const facts = [
      fact("LEAD_QUALIFIED", { leadId: "lead-1" }),
      fact("LEAD_QUALIFIED", { leadId: "lead-1" }),
      fact("LEAD_QUALIFIED", { leadId: "lead-2" }),
      fact("LEAD_QUALIFIED", { leadId: "lead-2", quantity: -1 }),
    ];
    expect(summarizeDashboardSellerActivity(facts, [{ id: memberId, name: "Vendedor" }])[0]?.qualified).toBe(1);
  });

  it("explica ligações sem subtipo ou sem desfecho", () => {
    const facts = [
      fact("CALL_ATTEMPTED", { quantity: 6 }),
      fact("CALL_CONNECTED"),
      fact("CALL_UNANSWERED", { quantity: 2 }),
      fact("CALL_UNANSWERED", { result: "NO_ANSWER" }),
      fact("CALL_FAILED"),
    ];
    expect(summarizeDashboardSellerActivity(facts, [{ id: memberId, name: "Vendedor" }])[0]).toMatchObject({
      calls: 6, connected: 1, unanswered: 3, noAnswer: 1, otherUnanswered: 2,
      callFailed: 1, otherFailures: 1, withoutOutcome: 1,
    });
  });

  it("expõe resultados de tarefas de Instagram sem confundir falhas com envios", () => {
    const facts = [
      fact("TASK_COMPLETED", { taskKind: "INSTAGRAM_MESSAGE", result: "PROFILE_NOT_FOUND" }),
      fact("TASK_COMPLETED", { taskKind: "INSTAGRAM_MESSAGE", result: "FAILED" }),
      fact("TASK_COMPLETED", { taskKind: "INSTAGRAM_FOLLOW", result: "ALREADY_FOLLOWING" }),
      fact("TASK_COMPLETED", { taskKind: "INSTAGRAM_FOLLOW", result: "CHANNEL_UNAVAILABLE" }),
      fact("INSTAGRAM_MESSAGE_SENT", { sourceEntityType: "MessageStatusEvent" }),
      fact("INSTAGRAM_FOLLOW_COMPLETED"),
      fact("EMAIL_SENT", { sourceEntityType: "ProspectingEmailJob" }),
    ];
    expect(summarizeDashboardSellerActivity(facts, [{ id: memberId, name: "Vendedor" }])[0]).toMatchObject({
      instagramMessages: 1, instagramFollows: 1, emailsSent: 1, instagramMessagesProfileNotFound: 1,
      instagramMessagesFailed: 1, instagramFollowsAlreadyFollowing: 1, instagramFollowsFailed: 1,
    });
  });
});
