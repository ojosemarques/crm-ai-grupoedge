import { describe, expect, it } from "vitest";
import { meetingGuests, participantEmailsSchema } from "./meeting-participants";

describe("convidados de reunião", () => {
  it("normaliza e deduplica endereços", () => {
    expect(participantEmailsSchema.parse([" PESSOA@example.test ", "pessoa@example.test", "outra@example.test"]))
      .toEqual(["pessoa@example.test", "outra@example.test"]);
  });
  it("rejeita endereço inválido e excesso de convidados", () => {
    expect(participantEmailsSchema.safeParse(["inválido"]).success).toBe(false);
    expect(participantEmailsSchema.safeParse(Array.from({ length: 21 }, (_, i) => `p${i}@example.test`)).success).toBe(false);
  });
  it("não ressuscita o antigo primeiro convidado editado por uma versão anterior", () => {
    expect(meetingGuests({ participantEmail: "novo@example.test", participantResponseStatus: "NEEDS_ACTION", participantResponseUpdatedAt: null,
      participants: [{ email: "antigo@example.test", position: 0, responseStatus: "ACCEPTED", responseUpdatedAt: null }],
    }).map((guest) => guest.email)).toEqual(["novo@example.test"]);
  });
  it("preserva a resposta primária durante compatibilidade com clientes antigos", () => {
    expect(meetingGuests({ participantEmail: "primeiro@example.test", participantResponseStatus: "ACCEPTED", participantResponseUpdatedAt: null,
      participants: [{ email: "primeiro@example.test", responseStatus: "NEEDS_ACTION", responseUpdatedAt: null }, { email: "segundo@example.test", responseStatus: "DECLINED", responseUpdatedAt: null }],
    })).toEqual([
      { email: "primeiro@example.test", responseStatus: "ACCEPTED", responseUpdatedAt: null },
      { email: "segundo@example.test", responseStatus: "DECLINED", responseUpdatedAt: null },
    ]);
  });
});
