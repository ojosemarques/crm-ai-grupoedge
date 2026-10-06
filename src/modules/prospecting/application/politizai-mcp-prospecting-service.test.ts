import { describe, expect, it } from "vitest";
import { z } from "zod";

import { registerCandidateSchema } from "@/modules/prospecting/application/politizai-mcp-prospecting-service";

describe("registerCandidateSchema", () => {
  it("publica todos os contatos como opcionais no contrato MCP", () => {
    const jsonSchema = z.toJSONSchema(registerCandidateSchema) as {
      properties?: { contact?: { required?: string[] } };
    };

    expect(jsonSchema.properties?.contact?.required).toBeUndefined();
  });

  it("aceita telefone sem e-mail e Instagram sem telefone", () => {
    const base = {
      targetId: crypto.randomUUID(),
      leaseOwner: `dot:${crypto.randomUUID()}`,
      politician: {
        mandateStatus: "CURRENT" as const,
        mandateVerifiedAt: "2026-10-06T14:00:00-03:00",
      },
      sources: [
        { field: "mandate" as const, type: "CITY_COUNCIL" as const, url: "https://camara.example.gov.br/vereador", observedAt: "2026-10-06T14:00:00-03:00" },
        { field: "phone" as const, type: "CITY_COUNCIL" as const, url: "https://camara.example.gov.br/contatos", observedAt: "2026-10-06T14:00:00-03:00", contactScope: "OFFICE" as const },
        { field: "instagram" as const, type: "INSTITUTIONAL_PROFILE" as const, url: "https://www.instagram.com/vereador", observedAt: "2026-10-06T14:00:00-03:00", contactScope: "POLITICIAN" as const },
      ],
    };

    expect(registerCandidateSchema.safeParse({
      ...base,
      contact: { phone: "+553837541402", phoneScope: "OFFICE" },
    }).success).toBe(true);
    expect(registerCandidateSchema.safeParse({
      ...base,
      contact: { instagram: "https://www.instagram.com/vereador", instagramScope: "POLITICIAN" },
    }).success).toBe(true);
  });
});
