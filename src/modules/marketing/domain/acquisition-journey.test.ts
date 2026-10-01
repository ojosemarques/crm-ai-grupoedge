import { describe, expect, it } from "vitest";
import { buildAcquisitionJourney, type AcquisitionJourneyFact } from "./acquisition-journey";

const fact = (overrides: Partial<AcquisitionJourneyFact> = {}): AcquisitionJourneyFact => ({
  leadId: crypto.randomUUID(), leadName: "Lead", leadCreatedAt: "2026-09-30T12:00:00.000Z", sourceName: "Meta",
  campaignName: "Campanha A", creativeName: "Criativo A", entryPoint: "Página /oferta", meetingId: null,
  meetingAt: null, meetingStatus: null, opportunityId: null, opportunityName: null, wonAt: null,
  wonValueCents: "0", invoiceId: null, receivedAt: null, receivedCents: "0", ...overrides,
});

describe("jornada completa de aquisição", () => {
  it("consolida campanha até recebimento sem duplicar o lead", () => {
    const journey = buildAcquisitionJourney([
      fact({ meetingId: crypto.randomUUID(), meetingStatus: "COMPLETED", opportunityId: crypto.randomUUID(), wonAt: "2026-10-03T12:00:00.000Z", wonValueCents: "100000", invoiceId: crypto.randomUUID(), receivedAt: "2026-10-10T12:00:00.000Z", receivedCents: "75000" }),
      fact({ campaignName: null, creativeName: null, entryPoint: "WhatsApp", leadName: "Lead 2" }),
    ]);
    expect(journey.stages.map(stage => [stage.key, stage.count])).toEqual([
      ["CAMPAIGN", 1], ["CREATIVE", 1], ["ENTRY", 2], ["LEAD", 2], ["MEETING", 1], ["SALE", 1], ["RECEIPT", 1],
    ]);
    expect(journey.summary).toEqual({ cohortLeads: 2, receivedCents: "75000", traceableReceipts: 1 });
    expect(journey.campaigns.find(row => row.name === "Campanha A")).toMatchObject({ leads: 1, meetings: 1, sales: 1, receipts: 1, receivedCents: "75000" });
  });
});
