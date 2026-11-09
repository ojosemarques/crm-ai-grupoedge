type Band = 0 | 60 | 80 | 100;
type Ratio = { numerator: bigint; denominator: bigint };

function attainmentBand(scheduled: Ratio, attended: Ratio): Band {
  for (const band of [100, 80, 60] as const) {
    if (scheduled.numerator * 100n >= scheduled.denominator * BigInt(band) &&
      attended.numerator * 100n >= attended.denominator * BigInt(band)) return band;
  }
  return 0;
}

export function calculateSdrAdvertisingAttainment(input: {
  leads: number;
  bookedLeads: number;
  eligibleMeetings: number;
  heldMeetings: number;
  pendingMeetings: number;
  missingEvidence: number;
}) {
  const { leads, bookedLeads, eligibleMeetings, heldMeetings, pendingMeetings, missingEvidence } = input;
  if (Object.values(input).some((value) => !Number.isSafeInteger(value) || value < 0) ||
    bookedLeads > leads || heldMeetings + pendingMeetings > eligibleMeetings) {
    throw new RangeError("Contagens de coorte inconsistentes.");
  }

  const scheduled = leads ? { numerator: BigInt(bookedLeads) * 5n, denominator: BigInt(leads) * 2n } : null;
  const attended = eligibleMeetings ? { numerator: BigInt(heldMeetings) * 2n, denominator: BigInt(eligibleMeetings) } : null;
  const possibleAttendance = attended && { ...attended, numerator: attended.numerator + BigInt(pendingMeetings) * 2n };
  const minimumBand = scheduled && attended ? attainmentBand(scheduled, attended) : null;
  const maximumBand = scheduled && possibleAttendance ? attainmentBand(scheduled, possibleAttendance) : null;
  const coverage = missingEvidence > 0 || minimumBand !== maximumBand ? "REVIEW"
    : minimumBand === null ? "NO_BASE" : "READY";
  const lesser = scheduled && attended
    ? scheduled.numerator * attended.denominator <= attended.numerator * scheduled.denominator ? scheduled : attended
    : null;
  const attainmentBps = lesser ? Number(lesser.numerator * 10000n / lesser.denominator) : null;

  return {
    coverage, band: coverage === "READY" ? minimumBand : null,
    minimumBand, maximumBand, attainmentBps,
    progressBps: attainmentBps === null ? null : Math.min(attainmentBps, 10000),
  };
}

export function projectSdrAdvertisingCohorts(input: {
  from: Date;
  to: Date;
  through: Date;
  recordedThrough?: Date;
  arrivals: readonly { leadId: string; arrivedAt: Date }[];
  bookings: readonly { leadId: string; bookedAt: Date }[];
  meetings: readonly {
    chainId: string;
    occurrenceId: string;
    recordedAt: Date;
    scheduledAt: Date;
    outcome: "HELD" | "NO_SHOW" | "PENDING" | "CANCELLED";
    cancelledAt: Date | null;
  }[];
  missingEvidence: number;
}) {
  const inPeriod = (date: Date) => date >= input.from && date < input.to;
  const firstArrival = new Map<string, Date>();
  for (const arrival of input.arrivals) {
    if (arrival.arrivedAt > input.through) continue;
    const prior = firstArrival.get(arrival.leadId);
    if (!prior || arrival.arrivedAt < prior) firstArrival.set(arrival.leadId, arrival.arrivedAt);
  }
  const arrived = new Map([...firstArrival].filter(([, date]) => inPeriod(date)));
  const booked = new Set(input.bookings.filter((booking) => {
    const arrival = arrived.get(booking.leadId);
    return arrival && booking.bookedAt >= arrival && booking.bookedAt < input.to && booking.bookedAt <= input.through;
  }).map((booking) => booking.leadId));

  const latest = new Map<string, typeof input.meetings[number]>();
  for (const meeting of input.meetings) {
    if (meeting.recordedAt > (input.recordedThrough ?? input.through)) continue;
    const previous = latest.get(meeting.chainId);
    if (!previous || meeting.recordedAt > previous.recordedAt ||
      (meeting.recordedAt.getTime() === previous.recordedAt.getTime() && meeting.occurrenceId > previous.occurrenceId)) {
      latest.set(meeting.chainId, meeting);
    }
  }
  const eligible = [...latest.values()].filter((meeting) =>
    inPeriod(meeting.scheduledAt) && meeting.scheduledAt <= input.through &&
    !(meeting.outcome === "CANCELLED" && meeting.cancelledAt && meeting.cancelledAt < meeting.scheduledAt));
  const counts = {
    leads: arrived.size,
    bookedLeads: booked.size,
    eligibleMeetings: eligible.length,
    heldMeetings: eligible.filter((meeting) => meeting.outcome === "HELD").length,
    pendingMeetings: eligible.filter((meeting) => meeting.outcome === "PENDING" || meeting.outcome === "CANCELLED").length,
    missingEvidence: input.missingEvidence,
  };
  return {
    counts,
    attainment: calculateSdrAdvertisingAttainment(counts),
    leadIds: [...arrived.keys()].sort(),
    bookedLeadIds: [...booked].sort(),
    meetingIds: eligible.map((meeting) => meeting.occurrenceId).sort(),
  };
}
