import { describe, expect, it } from "vitest";
import { calculateSdrAdvertisingAttainment, projectSdrAdvertisingCohorts } from "./sdr-advertising-attainment";

describe("atingimento SDR de Anúncios", () => {
  const base = { leads: 100, bookedLeads: 40, eligibleMeetings: 40, heldMeetings: 16, pendingMeetings: 0, missingEvidence: 0 };

  it("usa o menor atingimento e limita apenas o progresso visual", () => {
    expect(calculateSdrAdvertisingAttainment({
      ...base, leads: 200, bookedLeads: 100, eligibleMeetings: 100, heldMeetings: 100,
    })).toMatchObject({ coverage: "READY", band: 100, attainmentBps: 12500, progressBps: 10000 });
  });

  it("compara os cortes sem arredondar", () => {
    expect(calculateSdrAdvertisingAttainment(base)).toMatchObject({ coverage: "READY", band: 80, attainmentBps: 8000 });
    expect(calculateSdrAdvertisingAttainment({ ...base, eligibleMeetings: 41 })).toMatchObject({ band: 60 });
    expect(calculateSdrAdvertisingAttainment({ ...base, heldMeetings: 12 })).toMatchObject({ band: 60 });
    expect(calculateSdrAdvertisingAttainment({ ...base, heldMeetings: 11 })).toMatchObject({ band: 0 });
  });

  it("separa falta de base, evidência ausente e resultado pendente que pode mudar a faixa", () => {
    expect(calculateSdrAdvertisingAttainment({ ...base, eligibleMeetings: 0, heldMeetings: 0 })).toMatchObject({ coverage: "NO_BASE", band: null });
    expect(calculateSdrAdvertisingAttainment({ ...base, missingEvidence: 1 })).toMatchObject({ coverage: "REVIEW", band: null });
    expect(calculateSdrAdvertisingAttainment({ ...base, heldMeetings: 15, pendingMeetings: 1 })).toMatchObject({
      coverage: "REVIEW", band: null, minimumBand: 60, maximumBand: 80,
    });
    expect(calculateSdrAdvertisingAttainment({ ...base, heldMeetings: 17, pendingMeetings: 1 })).toMatchObject({
      coverage: "READY", band: 80,
    });
  });
});

it("deduplica agenda por lead e considera apenas a ocorrência efetiva de cada remarcação", () => {
  const date = (value: string) => new Date(value);
  const oldMeeting = {
    chainId: "rescheduled", occurrenceId: "old", recordedAt: date("2026-11-01"), scheduledAt: date("2026-11-10"),
    outcome: "PENDING" as const, cancelledAt: null,
  };
  const result = projectSdrAdvertisingCohorts({
    from: date("2026-11-01"), to: date("2026-12-01"), through: date("2026-11-28"),
    arrivals: [
      { leadId: "new", arrivedAt: date("2026-11-01") },
      { leadId: "new", arrivedAt: date("2026-11-02") },
      { leadId: "outside", arrivedAt: date("2026-10-31") },
      { leadId: "outside", arrivedAt: date("2026-11-03") },
    ],
    bookings: [
      { leadId: "new", bookedAt: date("2026-11-03") },
      { leadId: "new", bookedAt: date("2026-11-04") },
      { leadId: "outside", bookedAt: date("2026-11-04") },
    ],
    meetings: [
      oldMeeting,
      { ...oldMeeting, occurrenceId: "new", recordedAt: date("2026-11-09"), scheduledAt: date("2026-12-05") },
      { ...oldMeeting, chainId: "previous-cohort", occurrenceId: "held", outcome: "HELD" },
      { ...oldMeeting, chainId: "no-show", occurrenceId: "no-show", outcome: "NO_SHOW" },
      { ...oldMeeting, chainId: "cancelled", occurrenceId: "cancelled", outcome: "CANCELLED", cancelledAt: date("2026-11-09") },
      { ...oldMeeting, chainId: "future", occurrenceId: "future", scheduledAt: date("2026-11-30") },
    ],
    missingEvidence: 0,
  });
  expect(result).toMatchObject({
    counts: { leads: 1, bookedLeads: 1, eligibleMeetings: 2, heldMeetings: 1, pendingMeetings: 0 },
    meetingIds: ["held", "no-show"],
  });
});
