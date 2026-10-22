import { expect, it, vi } from "vitest";
import { readOteSdrOrigins } from "./ote-sdr-origins";

it("atribui uma origem por lead/reunião sem transferir crédito na remarcação", async () => {
  const at = new Date("2026-10-22");
  const first = new Date("2026-10-01");
  const findMany = vi.fn().mockResolvedValueOnce([
    { eventType: "MEETING_SCHEDULED", leadId: "lead", opportunityId: null },
    { eventType: "MEETING_SCHEDULED", leadId: "another", opportunityId: null },
    { eventType: "SALE_WON", leadId: null, opportunityId: "explicit-sale" },
  ]).mockResolvedValueOnce([
    { leadId: "lead", meetingId: "meeting", bookedByMemberId: "sdr", occurredAt: first },
    { leadId: "lead", meetingId: "meeting", bookedByMemberId: "closer", occurredAt: at },
    { leadId: "another", meetingId: "other-meeting", bookedByMemberId: "another-sdr", occurredAt: first },
    { leadId: "another", meetingId: "other-meeting", bookedByMemberId: "sdr", occurredAt: at },
  ]);
  expect(await readOteSdrOrigins({ commercialMetricFact: { findMany } } as never, "workspace", "sdr", at)).toEqual({
    leads: [{ leadId: "lead", at: first }], meetingIds: ["meeting"], saleIds: ["explicit-sale"],
  });
  expect(findMany.mock.calls.every(([arg]) => arg.where.workspaceId === "workspace" && arg.where.reversedAt === null)).toBe(true);
});
