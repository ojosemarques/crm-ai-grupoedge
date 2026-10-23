import { describe, expect, it } from "vitest";

import {
  googleEventParticipantPatch,
  googleParticipantResponseStatus,
} from "@/modules/integrations/application/google-calendar-worker-service";

describe("resposta do participante no Google Calendar", () => {
  it("sincroniza vários convidados, remove só os gerenciados e preserva respostas externas", () => {
    expect(googleEventParticipantPatch({
      attendees: [{ email: "remover@example.test" }, { email: "manter@example.test", responseStatus: "accepted" }, { email: "externo@example.test", responseStatus: "tentative" }],
      extendedProperties: { private: { crmGuest0: "remover@example.test", crmGuest1: "manter@example.test" } },
    }, ["manter@example.test", "novo@example.test"]).attendees).toEqual([
      { email: "manter@example.test", responseStatus: "accepted" }, { email: "externo@example.test", responseStatus: "tentative" }, { email: "novo@example.test" },
    ]);
  });
  it.each([
    ["needsAction", "NEEDS_ACTION"],
    ["accepted", "ACCEPTED"],
    ["tentative", "TENTATIVE"],
    ["declined", "DECLINED"],
    ["outro", "UNKNOWN"],
  ] as const)("converte %s para %s", (googleStatus, expected) => {
    expect(googleParticipantResponseStatus(
      [{ email: "Participante@Example.com", responseStatus: googleStatus }],
      "participante@example.com",
    )).toBe(expected);
  });

  it("ignora pessoas diferentes do participante da reunião", () => {
    expect(googleParticipantResponseStatus(
      [{ email: "outra@example.com", responseStatus: "accepted" }],
      "participante@example.com",
    )).toBeNull();
  });

  it("troca somente o participante gerenciado pelo CRM e preserva outros convidados", () => {
    expect(googleEventParticipantPatch({
      attendees: [
        { email: "anterior@example.com", responseStatus: "declined" },
        { email: "externo@example.com", responseStatus: "accepted", optional: true },
      ],
      extendedProperties: { private: { crmParticipantEmail: "anterior@example.com", outraChave: "preservada" } },
    }, "novo@example.com")).toEqual({
      attendees: [
        { email: "externo@example.com", responseStatus: "accepted", optional: true },
        { email: "novo@example.com" },
      ],
      privateProperties: { crmParticipantEmail: "anterior@example.com", outraChave: "preservada" },
    });
  });
});
