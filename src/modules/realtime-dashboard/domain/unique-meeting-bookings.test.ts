import { expect, it } from "vitest";
import { firstMeetingBookingIds, type MeetingBookingFact } from "./unique-meeting-bookings";

const booking = (id: string, leadId: string, day: string, overrides: Partial<MeetingBookingFact> = {}): MeetingBookingFact => ({
  id, leadId, occurredAt: new Date(`${day}T12:00:00Z`), quantity: 1, correctionOfFactId: null,
  contactId: null, lead: null, meetingId: id, ...overrides,
});

it("conta a pessoa só no primeiro agendamento, mesmo com outra reunião ou outro card", () => {
  const rows = [booking("first", "a", "2026-10-29", { lead: { contactId: "person" } }),
    booking("again", "a", "2026-10-30", { lead: { contactId: "person" } }),
    booking("other-card", "b", "2026-10-30", { lead: { contactId: "person" } }),
    booking("new-person", "c", "2026-10-30")];
  expect([...firstMeetingBookingIds(rows.reverse())]).toEqual(["first", "new-person"]);
});

it("aplica estornos antes de escolher o primeiro agendamento e conta uma vez por pessoa", () => {
  const first = booking("first", "a", "2026-10-29");
  expect([...firstMeetingBookingIds([first, { ...first, id: "undo", quantity: -1, correctionOfFactId: first.id },
    booking("next", "a", "2026-10-30", { quantity: 2 }), booking("duplicate", "a", "2026-10-31")])]).toEqual(["next"]);
});

it("preserva um fato positivo de substituição após a remoção do original", () => {
  expect([...firstMeetingBookingIds([booking("replacement", "a", "2026-10-30", { correctionOfFactId: "replaced" })])]).toEqual(["replacement"]);
});
