import { describe, expect, it } from "vitest";
import { defaultHomeView, maskContactPoint, normalizeGlobalSearchTerm, rankOperationalActions, type OperationalAction } from "./workspace-experience-contracts";

const action = (id: string, urgency: OperationalAction["urgency"], dueAt: string | null): OperationalAction => ({ kind: "TEST", title: id, reason: "fato persistido", urgency, entityType: "Lead", entityId: id, entityLabel: id, dueAt, href: `/leads/${id}`, cta: "Abrir" });

describe("experiência de workspace", () => {
  it("normaliza busca sem destruir palavras", () => expect(normalizeGlobalSearchTerm("  João   Ávila ")).toBe("joao avila"));
  it("mascara pontos de contato antes da serialização", () => {
    expect(maskContactPoint("PHONE", "+551199998877")).toBe("•••• 8877");
    expect(maskContactPoint("EMAIL", "maria@empresa.com")).toBe("m•••@empresa.com");
    expect(maskContactPoint("WHATSAPP", "+551199998866")).toBe("•••• 8866");
    expect(maskContactPoint("INSTAGRAM", "@maria")).toBe("@m•••");
  });
  it("prioriza risco e prazo de forma determinística", () => expect(rankOperationalActions([action("b", "NORMAL", null), action("a", "CRITICAL", "2026-09-13T10:00:00.000Z"), action("c", "ATTENTION", null)]).map((item) => item.entityId)).toEqual(["a", "c", "b"]));
  it("escolhe visão pelo papel e cai para a primeira autorizada", () => {
    expect(defaultHomeView("sdr", ["SDR"])).toBe("SDR");
    expect(defaultHomeView("viewer", ["CUSTOMER_SUCCESS", "FARMER"])).toBe("CUSTOMER_SUCCESS");
  });
});
