import { describe, expect, it } from "vitest";
import { summarizeCommercialFront, type FrontSummaryFact } from "./commercial-front-summary";
describe("contribuições comerciais sem somar papéis", () => {
  const fact = (eventType: string, index: number, more: Partial<FrontSummaryFact> = {}): FrontSummaryFact => ({
    id: `${eventType}:${index}`, eventType, leadId: `lead:${index}`, contactId: `person:${index}`, pipelineId: "ads",
    meetingId: null, sourceEntityType: "MeetingHistory", bookedByMemberId: null, creditedMemberId: null, meetingOwnerMemberIdAtEvent: null,
    entryOutcome: "CREATED", occurredAt: "2058-05-20T12:00:00.000Z", identityConfirmed: true, quantity: 1, valueCents: null, correctionOfFactId: null, ...more,
  });
  it("30 entradas, Carlos 10 agendadas, Jhon 5/3 e Ede 5/4; 10/7 totais", () => {
    const facts = Array.from({ length: 30 }, (_, index) => [fact("LEAD_CREATED", index), fact("LEAD_SUBMISSION_ATTACHED", index)]).flat();
    for (let i = 0; i < 10; i++) {
      const owner = i < 5 ? "Jhon" : "Ede";
      facts.push(fact("MEETING_SCHEDULED", i, { bookedByMemberId: "Carlos", creditedMemberId: "Carlos", meetingOwnerMemberIdAtEvent: owner, meetingId: `meeting:${i}` }));
      if (i < 3 || (i >= 5 && i < 9)) facts.push(fact("MEETING_COMPLETED", i, { creditedMemberId: owner, meetingOwnerMemberIdAtEvent: owner, meetingId: `meeting:${i}` }));
    }
    const result = summarizeCommercialFront(facts);
    expect(result).toMatchObject({ entries: 30, participations: 30, uniquePeople: 30, booked: 10, completed: 7, bookingCohort: { numerator: 10, denominator: 30 }, completionCohort: { numerator: 7, denominator: 10 } });
    expect(result.members).toEqual(expect.arrayContaining([{ memberId: "Carlos", booked: 10, assigned: 0, completed: 0 }, { memberId: "Jhon", booked: 0, assigned: 5, completed: 3 }, { memberId: "Ede", booked: 0, assigned: 5, completed: 4 }]));
  });
  it("une pessoa confirmada nas frentes e não usa conclusão de outra coorte", () => {
    const result = summarizeCommercialFront([fact("LEAD_CREATED", 1), fact("LEAD_CREATED", 2, { contactId: "person:1", pipelineId: "prospecting" }), fact("MEETING_COMPLETED", 3, { meetingId: "other" })]);
    expect(result.uniquePeople).toBe(1);
    expect(result.completionCohort).toEqual({ numerator: 0, denominator: 0, rate: null });
  });
  it("retira ocorrências anuladas das populações distintas e atribuições", () => {
    const booking = fact("MEETING_SCHEDULED", 1, { meetingId: "cancelled", bookedByMemberId: "Carlos", meetingOwnerMemberIdAtEvent: "Jhon" });
    const result = summarizeCommercialFront([fact("LEAD_SUBMISSION_ATTACHED", 1), booking, { ...booking, id: "reversal", correctionOfFactId: booking.id, quantity: -1 }]);
    expect(result.booked).toBe(0);
    expect(result.members).toEqual([]);
    expect(result.bookingCohort).toEqual({ numerator: 0, denominator: 1, rate: 0 });
    expect(result.completionCohort.denominator).toBe(0);
  });

  it("mede tempos na coorte, mantém ausências e não infere reentrada por falta de criação", () => {
    const result = summarizeCommercialFront([
      fact("LEAD_SUBMISSION_ATTACHED", 1, { occurredAt: "2058-05-20T12:00:00Z", entryOutcome: "ATTACHED" }),
      fact("LEAD_SUBMISSION_ATTACHED", 2, { occurredAt: "2058-05-20T12:00:00Z", entryOutcome: null }),
      fact("CALL_ATTEMPTED", 1, { occurredAt: "2058-05-20T12:01:00Z" }),
      fact("CALL_CONNECTED", 1, { occurredAt: "2058-05-20T12:02:00Z" }),
      fact("MEETING_SCHEDULED", 1, { occurredAt: "2058-05-20T13:00:00Z" }),
    ]);
    expect(result.reentries).toBe(1);
    expect(result.unresolvedEntries).toBe(1);
    expect(result.timing.find((row) => row.id === "time-first-action")).toMatchObject({ statistics: { medianSeconds: 60, sampleCount: 1 }, missingCount: 1 });
    expect(result.timing.find((row) => row.id === "time-first-response")?.statistics.medianSeconds).toBe(120);
    expect(result.timing.find((row) => row.id === "time-booking")?.statistics.medianSeconds).toBe(3600);
    expect(result.timing.find((row) => row.id === "time-result")?.statistics.medianSeconds).toBeNull();
  });
});
