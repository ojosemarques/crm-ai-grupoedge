import { describe, expect, it } from "vitest";

import { leadEntryResponse } from "@/modules/leads/http/lead-entry-route";

describe("resposta HTTP dos canais de entrada", () => {
  it("usa 422 para rejeição direta ou aninhada do serviço único", () => {
    expect(
      leadEntryResponse({ outcome: "REJECTED", issues: [] }, 201).status,
    ).toBe(422);
    expect(
      leadEntryResponse(
        { eventStatus: "FAILED", result: { outcome: "REJECTED", issues: [] } },
        201,
      ).status,
    ).toBe(422);
  });

  it("preserva o status de sucesso informado pelo adaptador", () => {
    expect(leadEntryResponse({ outcome: "CREATED" }, 201).status).toBe(201);
  });
});
