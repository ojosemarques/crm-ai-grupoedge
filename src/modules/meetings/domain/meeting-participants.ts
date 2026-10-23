import { z } from "zod";
import type { MeetingParticipantResponseStatusValue } from "./meeting-contracts";

export const MAX_MEETING_PARTICIPANTS = 20;
export const participantEmailSchema = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
export const participantEmailsSchema = z.array(participantEmailSchema).max(MAX_MEETING_PARTICIPANTS)
  .transform((emails) => [...new Set(emails)]);

export type MeetingGuest = Readonly<{
  email: string;
  responseStatus: MeetingParticipantResponseStatusValue;
  responseUpdatedAt: Date | null;
  position?: number;
}>;

// Legacy primary fields remain readable during rolling deploys and by older clients.
export function meetingGuests(meeting: Readonly<{
  participantEmail: string | null;
  participantResponseStatus: MeetingParticipantResponseStatusValue | null;
  participantResponseUpdatedAt: Date | null;
  participants: readonly MeetingGuest[];
}>): readonly MeetingGuest[] {
  const primary = meeting.participantEmail;
  return [
    ...(primary ? [{ email: primary, responseStatus: meeting.participantResponseStatus ?? "NEEDS_ACTION" as const, responseUpdatedAt: meeting.participantResponseUpdatedAt }] : []),
    ...meeting.participants.filter((guest) => guest.email !== primary && guest.position !== 0),
  ];
}

export function participantEmailsFromForm(data: FormData) {
  return data.getAll("participantEmail").map(String).map((email) => email.trim()).filter(Boolean);
}
