import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import {
  normalizeRegisterCandidateSources,
  registerCandidateSchema,
} from "@/modules/prospecting/application/politizai-mcp-prospecting-service";
import { prospectCandidateInputSchema } from "@/modules/prospecting/domain/prospecting-contracts";

describe("registerCandidateSchema", () => {
  it("publica todos os contatos como opcionais no contrato anunciado pelo SDK MCP", () => {
    const server = new McpServer({ name: "schema-regression", version: "1.0.0" });
    server.registerTool("registrar_candidato", { inputSchema: registerCandidateSchema }, async () => ({ content: [] }));
    const jsonSchema = server.toolInputSchemaJson("registrar_candidato") as {
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

  it("normaliza evidências válidas do MCP antes do contrato interno", () => {
    const observedAt = "2026-10-06T19:00:00-03:00";
    const input = registerCandidateSchema.parse({
      targetId: crypto.randomUUID(),
      leaseOwner: `dot:${crypto.randomUUID()}`,
      politician: { mandateStatus: "CURRENT", mandateVerifiedAt: observedAt },
      contact: {
        phone: "+557534251390",
        phoneScope: "OFFICE",
        email: "gabinete@example.gov.br",
        emailScope: "OFFICE",
      },
      sources: [
        { field: "role", type: "TSE", url: "https://resultados.tse.jus.br/oficial/app/index.html#/eleicao/619", observedAt },
        { field: "mandate", type: "CITY_HALL", url: "https://cidade.ba.gov.br/prefeita", observedAt },
        { field: "phone", type: "CITY_HALL", url: "https://cidade.ba.gov.br/gabinete", observedAt },
        { field: "email", type: "CITY_HALL", url: "https://cidade.ba.gov.br/gabinete", observedAt },
      ],
    });
    const sources = normalizeRegisterCandidateSources(input.contact, input.sources);

    expect(sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "phone", contactScope: "OFFICE" }),
      expect.objectContaining({ field: "email", contactScope: "OFFICE" }),
    ]));
    expect(sources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "role", type: "TSE" }),
    ]));
    expect(prospectCandidateInputSchema.safeParse({
      schemaVersion: "political-prospect/v1",
      idempotencyKey: "dot-target-regression",
      batchId: crypto.randomUUID(),
      externalIdentityKey: "tse-2024:regression",
      politician: {
        name: "Prefeita Regressão",
        role: "MAYOR",
        term: "2025-2028",
        mandateStatus: "CURRENT",
        mandateVerifiedAt: observedAt,
      },
      municipality: {
        ibgeCode: "2904902",
        name: "Cidade",
        stateCode: "BA",
        population: 30_450,
        populationEdition: "IBGE_ESTIMATIVA_2026",
      },
      contact: input.contact,
      sources: [
        { field: "role", type: "TSE", url: "https://resultados.tse.jus.br/oficial/2024/2904902", observedAt, validationMethod: "TSE_RESULTADOS_2024_SQ_CANDIDATO" },
        { field: "population", type: "IBGE", url: "https://ibge.gov.br/estimativa-2026", observedAt, validationMethod: "IBGE_ESTIMATIVA_2026_CODIGO_MUNICIPIO" },
        ...sources,
      ],
      agentVersion: "politizai-dot-mcp/test",
      promptVersion: "political-prospect-production/test",
    }).success).toBe(true);
  });
});
