import { describe, expect, it } from "vitest";

import { prospectCandidateInputSchema, researchBatchInputSchema } from "@/modules/prospecting/domain/prospecting-contracts";

function validCandidate() {
  const observedAt = "2026-10-05T12:00:00-03:00";
  return {
    schemaVersion: "political-prospect/v1",
    idempotencyKey: "candidate:3550308:123",
    batchId: crypto.randomUUID(),
    externalIdentityKey: "tse:2024:3550308:councilor:123",
    politician: { name: "João da Silva", role: "COUNCILOR", term: "2025-2028", mandateStatus: "CURRENT", mandateVerifiedAt: observedAt },
    municipality: { ibgeCode: "3550308", name: "São Paulo", stateCode: "SP", population: 30_000, populationEdition: "IBGE-2026" },
    contact: { phone: "+5511999999999", phoneScope: "OFFICE", email: "gabinete@example.gov.br", emailScope: "OFFICE", instagram: null, instagramScope: null },
    sources: [
      { field: "role", type: "TSE", url: "https://resultados.tse.jus.br/oficial/2024/3550308/123", observedAt, validationMethod: "TSE_2024_RESULT" },
      { field: "role", type: "CITY_COUNCIL", url: "https://www.saopaulo.sp.leg.br/vereadores/123", observedAt, validationMethod: "OFFICIAL_SOURCE_CHECK" },
      { field: "mandate", type: "OFFICIAL_GAZETTE", url: "https://diariooficial.prefeitura.sp.gov.br/mandato/123", observedAt, validationMethod: "OFFICIAL_SOURCE_CHECK" },
      { field: "population", type: "IBGE", url: "https://www.ibge.gov.br/cidades-e-estados/sp/sao-paulo.html", observedAt, validationMethod: "IBGE_EDITION_CHECK" },
      { field: "phone", type: "CITY_COUNCIL", url: "https://www.saopaulo.sp.leg.br/contato/123", observedAt, contactScope: "OFFICE", validationMethod: "OFFICIAL_SOURCE_CHECK" },
      { field: "email", type: "CITY_COUNCIL", url: "https://www.saopaulo.sp.leg.br/contato/123", observedAt, contactScope: "OFFICE", validationMethod: "OFFICIAL_SOURCE_CHECK" },
    ],
    agentVersion: "open-dot/1",
    promptVersion: "politizai-research/1",
  };
}

describe("prospectCandidateInputSchema", () => {
  it("aceita município com exatamente 30 mil habitantes e evidências oficiais", () => {
    expect(prospectCandidateInputSchema.safeParse(validCandidate()).success).toBe(true);
  });

  it("preserva contatos adicionais somente quando cada dado possui fonte e escopo", () => {
    const candidate = validCandidate();
    Object.assign(candidate.contact, {
      advisorPhone: "+551140001001",
      advisorEmail: "assessor@example.gov.br",
      whatsapp: "+5511999990001",
      whatsappScope: "ADVISOR",
      instagram: "@vereador",
      instagramScope: "POLITICIAN",
    });
    candidate.sources.push(
      { field: "advisor_phone", type: "CITY_COUNCIL", url: "https://www.saopaulo.sp.leg.br/contato/123", observedAt: candidate.sources[0]!.observedAt, contactScope: "ADVISOR", validationMethod: "OFFICIAL_SOURCE_CHECK" },
      { field: "advisor_email", type: "CITY_COUNCIL", url: "https://www.saopaulo.sp.leg.br/contato/123", observedAt: candidate.sources[0]!.observedAt, contactScope: "ADVISOR", validationMethod: "OFFICIAL_SOURCE_CHECK" },
      { field: "whatsapp", type: "CITY_COUNCIL", url: "https://www.saopaulo.sp.leg.br/contato/123", observedAt: candidate.sources[0]!.observedAt, contactScope: "ADVISOR", validationMethod: "OFFICIAL_SOURCE_CHECK" },
      { field: "instagram", type: "INSTITUTIONAL_PROFILE", url: "https://www.instagram.com/vereador", observedAt: candidate.sources[0]!.observedAt, contactScope: "POLITICIAN", validationMethod: "PUBLIC_PROFILE_CHECK" },
    );
    expect(prospectCandidateInputSchema.safeParse(candidate).success).toBe(true);
    candidate.sources = candidate.sources.filter((source) => source.field !== "advisor_email");
    expect(prospectCandidateInputSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejeita município com 29.999 habitantes", () => {
    const candidate = validCandidate();
    candidate.municipality.population = 29_999;
    expect(prospectCandidateInputSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejeita e-mail inválido, campo desconhecido e fonte obrigatória ausente", () => {
    const invalidEmail = validCandidate();
    invalidEmail.contact.email = "sem-email";
    expect(prospectCandidateInputSchema.safeParse(invalidEmail).success).toBe(false);

    expect(prospectCandidateInputSchema.safeParse({ ...validCandidate(), party: "XYZ" }).success).toBe(false);

    const missingPopulationEvidence = validCandidate();
    missingPopulationEvidence.sources = missingPopulationEvidence.sources.filter((source) => source.field !== "population");
    expect(prospectCandidateInputSchema.safeParse(missingPopulationEvidence).success).toBe(false);

    const missingTseEvidence = validCandidate();
    missingTseEvidence.sources = missingTseEvidence.sources.filter((source) => source.type !== "TSE");
    expect(prospectCandidateInputSchema.safeParse(missingTseEvidence).success).toBe(false);
  });

  it("rejeita edição ambígua e fonte que declara órgão oficial em domínio incompatível", () => {
    const wrongEdition = validCandidate();
    wrongEdition.municipality.populationEdition = "estimativa privada 2026";
    expect(prospectCandidateInputSchema.safeParse(wrongEdition).success).toBe(false);

    const forgedIbge = validCandidate();
    forgedIbge.sources = forgedIbge.sources.map((source) => source.type === "IBGE"
      ? { ...source, url: "https://dados.example.com/ibge/2026" }
      : source);
    expect(prospectCandidateInputSchema.safeParse(forgedIbge).success).toBe(false);

    const forgedTse = validCandidate();
    forgedTse.sources = forgedTse.sources.map((source) => source.type === "TSE"
      ? { ...source, url: "https://resultados.example.com/2024/3550308/123" }
      : source);
    expect(prospectCandidateInputSchema.safeParse(forgedTse).success).toBe(false);

    const malformedUrl = validCandidate();
    malformedUrl.sources[0]!.url = "não-é-url";
    expect(() => prospectCandidateInputSchema.safeParse(malformedUrl)).not.toThrow();
    expect(prospectCandidateInputSchema.safeParse(malformedUrl).success).toBe(false);
  });

  it("exige que a evidência do TSE identifique os resultados de 2024", () => {
    const candidate = validCandidate();
    candidate.sources = candidate.sources.map((source) => source.type === "TSE"
      ? { ...source, url: "https://resultados.tse.jus.br/oficial/2022/3550308/123", validationMethod: "TSE_RESULT" }
      : source);
    expect(prospectCandidateInputSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("researchBatchInputSchema", () => {
  const valid = {
    idempotencyKey: "batch:2026-10-05",
    horizonStart: "2026-10-05",
    horizonEnd: "2026-11-03",
    sourcePopulationEdition: "IBGE-2026",
    sourcePopulationHash: "a".repeat(64),
    sourcePopulationImportedAt: "2026-10-04T15:00:00.000Z",
    sourceElectionEdition: "TSE-RESULTADOS-2024",
    sourceElectionHash: "b".repeat(64),
    sourceElectionImportedAt: "2026-10-04T16:00:00.000Z",
    agentVersion: "open-dot/1",
    promptVersion: "politizai-research/1",
  };

  it("exige snapshots versionados do IBGE e TSE e horizonte exato de 30 dias", () => {
    expect(researchBatchInputSchema.safeParse(valid).success).toBe(true);
    expect(researchBatchInputSchema.safeParse({ ...valid, sourcePopulationHash: undefined }).success).toBe(false);
    expect(researchBatchInputSchema.safeParse({ ...valid, horizonEnd: "2026-11-04" }).success).toBe(false);
    expect(researchBatchInputSchema.safeParse({ ...valid, sourcePopulationEdition: "fonte-2026" }).success).toBe(false);
    expect(researchBatchInputSchema.safeParse({ ...valid, sourceElectionHash: undefined }).success).toBe(false);
    expect(researchBatchInputSchema.safeParse({ ...valid, sourceElectionEdition: "TSE-2022" }).success).toBe(false);
  });
});
