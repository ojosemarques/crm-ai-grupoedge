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
      researchChecks: {
        municipalOffice: { status: "INDIVIDUAL_CONTACTS_CAPTURED", url: "https://camara.example.gov.br/contatos", checkedAt: "2026-10-06T14:00:00-03:00" },
        tse2024Candidate: { status: "CONTACTS_NOT_PUBLIC", url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2024", checkedAt: "2026-10-06T14:00:00-03:00" },
        instagram: { status: "PROFILE_NOT_FOUND", checkedAt: "2026-10-06T14:00:00-03:00" },
      },
    }).success).toBe(true);
    expect(registerCandidateSchema.safeParse({
      ...base,
      contact: { instagram: "https://www.instagram.com/vereador", instagramScope: "POLITICIAN" },
      researchChecks: {
        municipalOffice: { status: "CONTACTS_NOT_PUBLISHED", url: "https://camara.example.gov.br/vereador", checkedAt: "2026-10-06T14:00:00-03:00" },
        tse2024Candidate: { status: "CONTACTS_NOT_PUBLIC", url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2024", checkedAt: "2026-10-06T14:00:00-03:00" },
        instagram: { status: "PROFILE_CAPTURED", url: "https://www.instagram.com/vereador", checkedAt: "2026-10-06T14:00:00-03:00" },
      },
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
      researchChecks: {
        municipalOffice: { status: "INDIVIDUAL_CONTACTS_CAPTURED", url: "https://cidade.ba.gov.br/gabinete", checkedAt: observedAt },
        tse2024Candidate: { status: "CONTACTS_NOT_PUBLIC", url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2024", checkedAt: observedAt },
        instagram: { status: "PROFILE_NOT_FOUND", checkedAt: observedAt },
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

  it("exige concluir gabinete individual, DivulgaCand 2024 e Instagram antes do cadastro", () => {
    const observedAt = "2026-10-08T12:00:00-03:00";
    const common = {
      targetId: crypto.randomUUID(),
      leaseOwner: `dot:${crypto.randomUUID()}`,
      politician: { mandateStatus: "CURRENT" as const, mandateVerifiedAt: observedAt },
      contact: { phone: "+556635411308", phoneScope: "OFFICE" as const, instagram: "https://www.instagram.com/vereador", instagramScope: "POLITICIAN" as const },
      sources: [
        { field: "mandate" as const, type: "CITY_COUNCIL" as const, url: "https://camara.example.gov.br/vereador", observedAt },
        { field: "phone" as const, type: "CITY_COUNCIL" as const, url: "https://camara.example.gov.br/gabinete", observedAt, contactScope: "OFFICE" as const, originalValue: "Telefone direto do gabinete: (66) 3541-1308" },
        { field: "instagram" as const, type: "INSTITUTIONAL_PROFILE" as const, url: "https://www.instagram.com/vereador", observedAt, contactScope: "POLITICIAN" as const },
      ],
    };

    expect(registerCandidateSchema.safeParse(common).success).toBe(false);
    expect(registerCandidateSchema.safeParse({
      ...common,
      researchChecks: {
        municipalOffice: { status: "INDIVIDUAL_CONTACTS_CAPTURED", url: "https://camara.example.gov.br/gabinete", checkedAt: observedAt },
        tse2024Candidate: { status: "CONTACTS_NOT_PUBLIC", url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2024", checkedAt: observedAt },
        instagram: { status: "PROFILE_CAPTURED", url: "https://www.instagram.com/vereador", checkedAt: observedAt },
      },
    }).success).toBe(true);
  });

  it("rejeita central compartilhada como telefone de gabinete individual", () => {
    const observedAt = "2026-10-08T12:00:00-03:00";
    expect(registerCandidateSchema.safeParse({
      targetId: crypto.randomUUID(),
      leaseOwner: `dot:${crypto.randomUUID()}`,
      politician: { mandateStatus: "CURRENT", mandateVerifiedAt: observedAt },
      contact: { phone: "+556635411308", phoneScope: "OFFICE" },
      researchChecks: {
        municipalOffice: { status: "SHARED_CONTACT_ONLY", url: "https://camara.example.gov.br/contato", checkedAt: observedAt },
        tse2024Candidate: { status: "CONTACTS_NOT_PUBLIC", url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2024", checkedAt: observedAt },
        instagram: { status: "PROFILE_NOT_FOUND", checkedAt: observedAt },
      },
      sources: [
        { field: "mandate", type: "CITY_COUNCIL", url: "https://camara.example.gov.br/vereador", observedAt },
        { field: "phone", type: "CITY_COUNCIL", url: "https://camara.example.gov.br/contato", observedAt, contactScope: "OFFICE", originalValue: "Central compartilhada da Câmara; não exclusivo" },
        { field: "role", type: "TSE", url: "https://resultados.tse.jus.br/oficial/app/index.html#/eleicao/619", observedAt },
      ],
    }).success).toBe(false);
  });

  it("aceita contato eleitoral somente com evidência específica do TSE 2024", () => {
    const observedAt = "2026-10-08T12:00:00-03:00";
    const payload = {
      targetId: crypto.randomUUID(),
      leaseOwner: `dot:${crypto.randomUUID()}`,
      politician: { mandateStatus: "CURRENT" as const, mandateVerifiedAt: observedAt },
      contact: { politicianPhone: "+5511999999999", politicianEmail: "candidato@example.com" },
      researchChecks: {
        municipalOffice: { status: "CONTACTS_NOT_PUBLISHED" as const, url: "https://camara.example.gov.br/vereador", checkedAt: observedAt },
        tse2024Candidate: { status: "CONTACTS_CAPTURED" as const, url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2024", checkedAt: observedAt },
        instagram: { status: "PROFILE_NOT_FOUND" as const, checkedAt: observedAt },
      },
      sources: [
        { field: "mandate" as const, type: "CITY_COUNCIL" as const, url: "https://camara.example.gov.br/vereador", observedAt },
        { field: "politician_phone" as const, type: "TSE" as const, url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2024", observedAt, contactScope: "POLITICIAN" as const, validationMethod: "TSE_2024_PUBLIC_CONTACT_CHECK" },
        { field: "politician_email" as const, type: "TSE" as const, url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2024", observedAt, contactScope: "POLITICIAN" as const, validationMethod: "TSE_2024_PUBLIC_CONTACT_CHECK" },
      ],
    };

    expect(registerCandidateSchema.safeParse(payload).success).toBe(true);
    expect(registerCandidateSchema.safeParse({
      ...payload,
      sources: payload.sources.map((source) => ({ ...source, type: "CITY_COUNCIL" as const, url: "https://camara.example.gov.br/vereador" })),
    }).success).toBe(false);
  });
});
