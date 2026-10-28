import { describe, expect, it } from "vitest";
import { advertisingAssignedMeetings, advertisingLeadArrivals, advertisingPeriodFacts, type RealtimeActivityFact } from "./realtime-advertising-metrics";

const fact = (id: string, eventType: string, leadId: string, quantity = 1, occurredAt = "2026-10-28T13:00:00Z"): RealtimeActivityFact => ({
  id, eventType, leadId, quantity, occurredAt, sourceEntityType: "Activity", creditedMemberId: "carlos", performedByMemberId: null,
  bookedByMemberId: null, taskKind: null, result: null, cadenceStepKey: null, valueCents: null,
});

it("usa o responsável histórico do card para agendamentos antigos e respeita a atribuição posterior na Agenda", () => {
  const stage = { ...fact("stage", "MEETING_SCHEDULED", "lead"), sourceEntityType: "StageHistory", meetingOwnerMemberIdAtEvent: null, leadOwnerMemberIdAtEvent: "jhon" };
  expect(advertisingAssignedMeetings([stage], "jhon")).toBe(1);
  expect(advertisingAssignedMeetings([{ ...stage, sourceEntityType: "MeetingHistory" }], "jhon")).toBe(0);
  const corrected = [stage, { ...stage, id: "undo", quantity: -1 }, { ...stage, id: "assigned", meetingId: "meeting", meetingOwnerMemberIdAtEvent: "ede" }];
  expect(advertisingAssignedMeetings(corrected, "jhon")).toBe(0);
  expect(advertisingAssignedMeetings(corrected, "ede")).toBe(1);
});

describe("leads recebidos de anúncios", () => {
  it("conta entradas sem atividade, sem duplicar cadastro, formulário ou reenvios do mesmo lead", () => {
    const facts = [fact("created", "LEAD_CREATED", "a"), fact("entry", "LEAD_SUBMISSION_ATTACHED", "a"), fact("repeat", "LEAD_SUBMISSION_ATTACHED", "a"), fact("untouched", "LEAD_CREATED", "b")];
    expect(advertisingLeadArrivals(facts).size).toBe(2);
  });
  it("conta somente a atividade posterior à entrada dos leads do período e respeita estornos", () => {
    const facts = [fact("entry", "LEAD_CREATED", "new"), fact("call", "CALL_ATTEMPTED", "new"), fact("old-call", "CALL_ATTEMPTED", "old"), fact("before", "EMAIL_SENT", "new", 1, "2026-10-28T12:00:00Z"), fact("reversed", "LEAD_CREATED", "removed"), fact("undo", "LEAD_CREATED", "removed", -1), fact("removed-call", "CALL_ATTEMPTED", "removed"), fact("meeting", "MEETING_COMPLETED", "old")];
    expect([...advertisingLeadArrivals(facts).keys()]).toEqual(["new"]);
    expect(advertisingPeriodFacts(facts).map(fact => fact.id)).toEqual(["entry", "call", "reversed", "undo", "meeting"]);
  });
});
