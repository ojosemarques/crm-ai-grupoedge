import { describe, expect, it } from "vitest";
import type { CommercialMetricFactInput } from "./commercial-metric-fact-writer";
import { commercialMetricFactFingerprint } from "./commercial-metric-fact-writer";
import { meetingBookingCreditRestoration } from "./meeting-booking-credit-restoration";

const original = {
  id: "original", workspaceId: "workspace", eventKey: "meeting-history:history:scheduled:v1",
  eventType: "MEETING_SCHEDULED", occurredAt: new Date("2035-02-10T15:00:00Z"),
  sourceEntityType: "MeetingHistory", sourceEntityId: "history", sourceRevision: 1,
  meetingId: "meeting", creditedMemberId: "booker", bookedByMemberId: "booker",
  performedByMemberId: "booker", meetingOwnerMemberIdAtEvent: "closer", quantity: 1,
} satisfies CommercialMetricFactInput & { id: string };
const reversal = {
  ...original, id: "reversal", quantity: -1, correctionOfFactId: original.id,
  eventKey: `${original.eventKey}:meeting-edit:2f330df9-ba2d-435f-8aac-acfc48ad4e6c:reversal:v1`,
  creditedMemberId: "editor", bookedByMemberId: null,
};

describe("restauração do crédito de agendamento", () => {
  it("compensa o débito no mesmo vendedor sem transferir o crédito original ao editor", () => {
    const restored = meetingBookingCreditRestoration(reversal, original)!;
    expect(restored).toMatchObject({
      quantity: 1, bookedByMemberId: null, creditedMemberId: "editor",
      meetingOwnerMemberIdAtEvent: "closer", occurredAt: original.occurredAt,
      correctionOfFactId: reversal.id, executionMode: "SYSTEM",
    });
    expect(restored.eventKey).toBe(`${reversal.eventKey}:booking-credit-restored:v1`);
    const byMember = new Map<string, number>();
    for (const fact of [original, reversal, restored]) {
      const memberId = fact.bookedByMemberId ?? fact.creditedMemberId!;
      byMember.set(memberId, (byMember.get(memberId) ?? 0) + fact.quantity!);
    }
    expect(Object.fromEntries(byMember)).toEqual({ booker: 1, editor: 0 });
    expect(commercialMetricFactFingerprint(restored)).toBe(
      commercialMetricFactFingerprint(meetingBookingCreditRestoration(reversal, original)!),
    );
  });

  it.each([
    { workspaceId: "other" }, { meetingId: "other" }, { sourceEntityId: "other" },
    { correctionOfFactId: "other" }, { quantity: 1 }, { sourceEntityType: "Task" },
    { occurredAt: new Date("2035-02-11T15:00:00Z") },
    { eventType: "MEETING_COMPLETED" as const },
    { eventKey: `${original.eventKey}:attribution:reversal:v1` },
    { eventKey: `${original.eventKey}:legacy:reversal:v1` },
  ])("rejeita estorno incompatível ou legítimo: %j", (change) => {
    expect(meetingBookingCreditRestoration({ ...reversal, ...change }, original)).toBeNull();
  });

  it("não restaura uma correção de outro fato nem uma quantidade inválida", () => {
    expect(meetingBookingCreditRestoration(reversal, { ...original, correctionOfFactId: "prior" })).toBeNull();
    expect(meetingBookingCreditRestoration({ ...reversal, quantity: 0 }, { ...original, quantity: 0 })).toBeNull();
  });
});
