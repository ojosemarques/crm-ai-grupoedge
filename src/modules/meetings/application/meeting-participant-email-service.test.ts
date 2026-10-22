import { describe, expect, it } from "vitest";

import {
  buildMeetingParticipantEmail,
  meetingParticipantEmailSchedule,
} from "@/modules/meetings/application/meeting-participant-email-service";

describe("e-mails do participante da reunião", () => {
  it("agenda os quatro avisos nos instantes corretos", () => {
    const startsAt = new Date("2035-02-20T15:00:00.000Z");
    expect(meetingParticipantEmailSchedule(startsAt, new Date("2035-02-20T10:00:00.000Z"))).toEqual([
      { reminderMinutes: 180, runAt: new Date("2035-02-20T12:00:00.000Z") },
      { reminderMinutes: 60, runAt: new Date("2035-02-20T14:00:00.000Z") },
      { reminderMinutes: 30, runAt: new Date("2035-02-20T14:30:00.000Z") },
      { reminderMinutes: 0, runAt: new Date("2035-02-20T15:00:00.000Z") },
    ]);
  });

  it("não cria aviso cujo horário já passou", () => {
    expect(meetingParticipantEmailSchedule(
      new Date("2035-02-20T15:00:00.000Z"),
      new Date("2035-02-20T14:10:00.000Z"),
    ).map((item) => item.reminderMinutes)).toEqual([30, 0]);
  });

  it("inclui horário, responsável e link do Google Meet no convite", () => {
    const email = buildMeetingParticipantEmail({
      emailKind: "INVITATION",
      reminderMinutes: null,
      title: "Diagnóstico do mandato",
      leadName: "Pessoa de teste",
      closerName: "Closer de teste",
      startsAt: new Date("2035-02-20T15:00:00.000Z"),
      timeZone: "America/Sao_Paulo",
      conferenceUrl: "https://meet.google.com/abc-defg-hij",
    });
    expect(email.subject).toBe("Convite: Diagnóstico do mandato");
    expect(email.text).toContain("terça-feira, 20 de fevereiro de 2035 às 12:00");
    expect(email.text).toContain("Responsável: Closer de teste");
    expect(email.text).toContain("https://meet.google.com/abc-defg-hij");
  });
});
