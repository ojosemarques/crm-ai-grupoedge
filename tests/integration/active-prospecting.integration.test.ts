import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createOpenDotRequestService } from "@/modules/prospecting/application/open-dot-request-service";
import { applyProspectingTaskCompletionInTransaction } from "@/modules/prospecting/application/prospecting-cadence-service";
import { createProspectingEmailService } from "@/modules/prospecting/application/prospecting-email-service";
import { createProspectingPlannerService } from "@/modules/prospecting/application/prospecting-planner-service";
import { createProspectingReconciliationService } from "@/modules/prospecting/application/prospecting-reconciliation-service";
import { createProspectingReleaseService } from "@/modules/prospecting/application/prospecting-release-service";
import { createProspectingStagingService } from "@/modules/prospecting/application/prospecting-staging-service";
import { PROSPECTING_CADENCE } from "@/modules/prospecting/domain/prospecting-cadence";
import type { OpenDotPrincipal } from "@/modules/prospecting/domain/open-dot-policy";
import { signOpenDotRequest } from "@/modules/prospecting/domain/open-dot-policy";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for prospecting integration tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 10 }) });
let clock = new Date("2026-10-05T15:00:00.000Z");
const service = createProspectingStagingService({ database, now: () => clock });
let principal: OpenDotPrincipal;
let batchId: string;
let systemActorId: string;
let initialLeadCount: number;

function candidate(overrides: Record<string, unknown> = {}) {
  const observedAt = "2026-10-05T12:00:00-03:00";
  return {
    schemaVersion: "political-prospect/v1",
    idempotencyKey: "candidate:integration:1",
    batchId,
    externalIdentityKey: "tse:2024:3550308:councilor:123",
    politician: { name: "Vereadora Integração", role: "COUNCILOR", term: "2025-2028", mandateStatus: "CURRENT", mandateVerifiedAt: observedAt },
    municipality: { ibgeCode: "3550308", name: "São Paulo", stateCode: "SP", population: 12_000_000, populationEdition: "IBGE-2026" },
    contact: { phone: "+551140001000", phoneScope: "OFFICE", email: "gabinete@camara.example.test", emailScope: "OFFICE", politicianPhone: "+5511999990999", politicianEmail: "politica.publica@example.test", advisorPhone: "+551140001001", advisorEmail: "assessor@camara.example.test", whatsapp: "+5511999991000", whatsappScope: "OFFICE", instagram: "@vereadora", instagramScope: "POLITICIAN" },
    sources: [
      { field: "role", type: "TSE", url: "https://resultados.tse.jus.br/oficial/2024/3550308/123", observedAt, validationMethod: "TSE_2024_RESULT" },
      { field: "role", type: "CITY_COUNCIL", url: "https://www.saopaulo.sp.leg.br/vereadores/123", observedAt, validationMethod: "OFFICIAL_SOURCE_CHECK" },
      { field: "mandate", type: "OFFICIAL_GAZETTE", url: "https://diariooficial.prefeitura.sp.gov.br/mandato/123", observedAt, validationMethod: "OFFICIAL_SOURCE_CHECK" },
      { field: "population", type: "IBGE", url: "https://www.ibge.gov.br/cidades-e-estados/sp/sao-paulo.html", observedAt, validationMethod: "IBGE_EDITION_CHECK" },
      { field: "phone", type: "CITY_COUNCIL", url: "https://www.saopaulo.sp.leg.br/contato/123", observedAt, contactScope: "OFFICE", validationMethod: "OFFICIAL_SOURCE_CHECK" },
      { field: "email", type: "CITY_COUNCIL", url: "https://www.saopaulo.sp.leg.br/contato/123", observedAt, contactScope: "OFFICE", validationMethod: "OFFICIAL_SOURCE_CHECK" },
      { field: "politician_phone", type: "TSE", url: "https://divulgacandcontas.tse.jus.br/candidato/123", observedAt, contactScope: "POLITICIAN", validationMethod: "TSE_2024_PUBLIC_CONTACT_CHECK" },
      { field: "politician_email", type: "TSE", url: "https://divulgacandcontas.tse.jus.br/candidato/123", observedAt, contactScope: "POLITICIAN", validationMethod: "TSE_2024_PUBLIC_CONTACT_CHECK" },
      { field: "advisor_phone", type: "CITY_COUNCIL", url: "https://www.saopaulo.sp.leg.br/contato/123", observedAt, contactScope: "ADVISOR", validationMethod: "OFFICIAL_SOURCE_CHECK" },
      { field: "advisor_email", type: "CITY_COUNCIL", url: "https://www.saopaulo.sp.leg.br/contato/123", observedAt, contactScope: "ADVISOR", validationMethod: "OFFICIAL_SOURCE_CHECK" },
      { field: "whatsapp", type: "CITY_COUNCIL", url: "https://www.saopaulo.sp.leg.br/contato/123", observedAt, contactScope: "OFFICE", validationMethod: "OFFICIAL_SOURCE_CHECK" },
      { field: "instagram", type: "INSTITUTIONAL_PROFILE", url: "https://www.instagram.com/vereadora", observedAt, contactScope: "POLITICIAN", validationMethod: "PUBLIC_PROFILE_CHECK" },
    ],
    agentVersion: "open-dot/integration",
    promptVersion: "politizai-research/1",
    ...overrides,
  };
}

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" });
  const workspace = await database.workspace.findUniqueOrThrow({ where: { id: seeded.workspaceId } });
  const systemActor = await database.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, type: "SYSTEM", key: "system" } });
  systemActorId = systemActor.id;
  const actor = await database.actor.create({ data: { workspaceId: workspace.id, type: "AI_AGENT", key: "open-dot-research-active-prospecting-test", displayName: "Open-Dot Pesquisa" } });
  principal = { clientId: "research-agent", workspaceId: workspace.id, actorId: actor.id, scopes: ["RESEARCH_WRITE", "RESEARCH_READ", "RESEARCH_REVIEW", "EMAIL_CLAIM", "EMAIL_RECEIPT", "EMAIL_EVENT_WRITE"] };
  initialLeadCount = await database.lead.count({ where: { workspaceId: workspace.id } });
  const created = await database.$transaction((transaction) => service.createResearchBatch(transaction, principal, { idempotencyKey: "batch:integration:2026-10", horizonStart: "2026-10-05", horizonEnd: "2026-11-03", sourcePopulationEdition: "IBGE-2026", sourcePopulationHash: "a".repeat(64), sourcePopulationImportedAt: "2026-10-04T15:00:00.000Z", sourceElectionEdition: "TSE-RESULTADOS-2024", sourceElectionHash: "b".repeat(64), sourceElectionImportedAt: "2026-10-04T16:00:00.000Z", agentVersion: "open-dot/integration", promptVersion: "politizai-research/1" }));
  batchId = created.batch.id;

  const seller = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, user: { normalizedEmail: "sdr1@demo.politizai.local" } } });
  const connection = await database.integrationConnection.create({ data: { workspaceId: workspace.id, key: "active-prospecting-email-test", providerKey: "test", adapterKey: "test-email", displayName: "E-mail de integração", environment: "LOCAL", status: "CONNECTED", capabilityLevel: "CONNECTED", enabled: true, createdByActorId: systemActor.id, updatedByActorId: systemActor.id } });
  const profile = await database.emailConnectionProfile.create({ data: { workspaceId: workspace.id, connectionId: connection.id, operatingMode: "EXTERNAL_READY", senderAddress: "sdr@example.test", senderAddressNormalized: "sdr@example.test", displayName: "SDR Integração", envelopeFrom: "sdr@example.test", replyTo: "respostas@example.test", domain: "example.test", smtpHost: "smtp.example.test", smtpPort: 587, spfStatus: "VERIFIED_EXTERNAL", dkimStatus: "VERIFIED_EXTERNAL", dmarcStatus: "VERIFIED_EXTERNAL", configuredAt: clock, validatedAt: clock, lastSuccessAt: clock, createdByActorId: systemActor.id, updatedByActorId: systemActor.id } });
  await database.prospectingSellerConfig.create({ data: { workspaceId: workspace.id, memberId: seller.id, senderProfileId: profile.id, active: true, dailyCapacity: 75, reservePercent: 10, dailyEmailLimit: 25, rotationPosition: 0, createdByActorId: systemActor.id, updatedByActorId: systemActor.id } });
  await database.prospectingSettings.upsert({ where: { workspaceId: workspace.id }, create: { workspaceId: workspace.id, releaseEnabled: true, emailEgressEnabled: true, privacyApprovedAt: clock, canaryApprovedAt: clock, createdByActorId: systemActor.id, updatedByActorId: systemActor.id }, update: { releaseEnabled: true, emailEgressEnabled: true, privacyApprovedAt: clock, canaryApprovedAt: clock, updatedByActorId: systemActor.id } });
  await database.prospectingEmailTemplateVersion.createMany({ data: PROSPECTING_CADENCE.filter((step) => step.executor === "OPEN_DOT").map((step) => {
    const subjectTemplate = "Olá, {primeiro_nome}: conversa sobre {municipio}/{uf}";
    const bodyTemplate = "Olá, {nome}. Sou {nome_vendedor}. Contato institucional para {cargo} de {municipio}/{uf}. {assinatura}";
    return { workspaceId: workspace.id, stepKey: step.stepKey, version: 1, subjectTemplate, bodyTemplate, allowedVariables: ["primeiro_nome", "nome", "nome_vendedor", "cargo", "municipio", "uf", "assinatura"], contentHash: createHash("sha256").update(`${subjectTemplate}\n${bodyTemplate}`).digest("hex"), published: true, publishedAt: clock, createdByActorId: systemActor.id };
  }) });
});

afterAll(async () => { await database.$disconnect(); });

describe("staging governado da Prospecção Ativa", () => {
  it("persiste candidato completo, evidências e replay idempotente sem criar Lead", async () => {
    const first = await database.$transaction((transaction) => service.ingestCandidate(transaction, principal, candidate()));
    const replay = await database.$transaction((transaction) => service.ingestCandidate(transaction, principal, candidate()));
    expect(first).toMatchObject({ duplicate: false, candidate: { status: "READY", revision: 1 } });
    expect(replay).toMatchObject({ duplicate: true, candidate: { id: first.candidate.id } });
    await expect(database.prospectCandidateSource.count({ where: { candidateId: first.candidate.id } })).resolves.toBe(12);
    await expect(database.prospectCandidate.findUniqueOrThrow({ where: { id: first.candidate.id }, select: { politicianPhone: true, politicianEmail: true, advisorPhone: true, advisorEmail: true, whatsapp: true, whatsappScope: true, instagram: true } })).resolves.toEqual({ politicianPhone: "+5511999990999", politicianEmail: "politica.publica@example.test", advisorPhone: "+551140001001", advisorEmail: "assessor@camara.example.test", whatsapp: "+5511999991000", whatsappScope: "OFFICE", instagram: "@vereadora" });
    await expect(database.lead.count({ where: { workspaceId: principal.workspaceId } })).resolves.toBe(initialLeadCount);
    await expect(database.prospectingResearchBatch.findUniqueOrThrow({ where: { id: batchId }, select: { sourcePopulationImportedAt: true, sourceElectionEdition: true, sourceElectionHash: true, sourceElectionImportedAt: true } })).resolves.toEqual({
      sourcePopulationImportedAt: new Date("2026-10-04T15:00:00.000Z"),
      sourceElectionEdition: "TSE-RESULTADOS-2024",
      sourceElectionHash: "b".repeat(64),
      sourceElectionImportedAt: new Date("2026-10-04T16:00:00.000Z"),
    });
  });

  it("rejeita data de importação de snapshot no futuro", async () => {
    await expect(database.$transaction((transaction) => service.createResearchBatch(transaction, principal, {
      idempotencyKey: "batch:integration:future-source",
      horizonStart: "2026-10-05",
      horizonEnd: "2026-11-03",
      sourcePopulationEdition: "IBGE-2026",
      sourcePopulationHash: "c".repeat(64),
      sourcePopulationImportedAt: "2026-10-06T15:00:00.000Z",
      sourceElectionEdition: "TSE-RESULTADOS-2024",
      sourceElectionHash: "d".repeat(64),
      sourceElectionImportedAt: "2026-10-04T16:00:00.000Z",
      agentVersion: "open-dot/integration",
      promptVersion: "politizai-research/1",
    }))).rejects.toMatchObject({ code: "PROSPECTING_SOURCE_IMPORT_IN_FUTURE" });
  });

  it("rejeita conflito de identidade e de chave idempotente", async () => {
    const changedContact = candidate({ contact: { phone: "+551140001001", phoneScope: "OFFICE", email: "outro@camara.example.test", emailScope: "OFFICE", instagram: null, instagramScope: null } });
    await expect(database.$transaction((transaction) => service.ingestCandidate(transaction, principal, changedContact))).rejects.toMatchObject({ code: "PROSPECTING_IDEMPOTENCY_CONFLICT" });
    const changedIdentity = candidate({ idempotencyKey: "candidate:integration:2", externalIdentityKey: "tse:2024:3550308:councilor:123", contact: { phone: "+551140001001", phoneScope: "OFFICE", email: "outro@camara.example.test", emailScope: "OFFICE", instagram: null, instagramScope: null } });
    await expect(database.$transaction((transaction) => service.ingestCandidate(transaction, principal, changedIdentity))).rejects.toMatchObject({ code: "PROSPECTING_IDENTITY_CONFLICT" });
  });

  it("mantém mandato inconclusivo em revisão e fora de Lead", async () => {
    const observedAt = "2026-10-05T12:00:00-03:00";
    const payload = candidate({
      idempotencyKey: "candidate:integration:mandate-review",
      externalIdentityKey: "tse:2024:3550308:councilor:999",
      politician: { name: "Suplente em revisão", role: "COUNCILOR", term: "2025-2028", mandateStatus: "INCONCLUSIVE", mandateVerifiedAt: observedAt },
      contact: { phone: "+551140001099", phoneScope: "OFFICE", email: "revisao@camara.example.test", emailScope: "OFFICE", instagram: null, instagramScope: null },
    });
    const result = await database.$transaction((transaction) => service.ingestCandidate(transaction, principal, payload));
    expect(result).toMatchObject({ duplicate: false, candidate: { status: "REVIEW_REQUIRED" } });
    await expect(database.prospectCandidate.findUnique({ where: { id: result.candidate.id }, select: { reviewReasonCode: true, leadId: true } })).resolves.toEqual({ reviewReasonCode: "MANDATE_INCONCLUSIVE", leadId: null });
  });

  it("mantém evidência municipal expirada em revisão", async () => {
    const staleObservedAt = "2026-08-01T12:00:00-03:00";
    const base = candidate({ idempotencyKey: "candidate:integration:stale", externalIdentityKey: "tse:2024:3550308:councilor:998" });
    const payload = {
      ...base,
      politician: { ...base.politician, mandateVerifiedAt: staleObservedAt },
      sources: base.sources.map((source) => source.type === "TSE" || source.type === "IBGE" ? source : { ...source, observedAt: staleObservedAt }),
    };
    const result = await database.$transaction((transaction) => service.ingestCandidate(transaction, principal, payload));
    expect(result).toMatchObject({ duplicate: false, candidate: { status: "REVIEW_REQUIRED" } });
    await expect(database.prospectCandidate.findUnique({ where: { id: result.candidate.id }, select: { reviewReasonCode: true } })).resolves.toEqual({ reviewReasonCode: "MANDATE_EVIDENCE_STALE" });
    await expect(database.$transaction((transaction) => service.reviewCandidate(transaction, principal, result.candidate.id, {
      status: "READY",
      reasonCode: "HUMAN_REVIEW_APPROVED",
      expectedRevision: result.candidate.revision,
      sourceDecisions: [],
    }))).rejects.toMatchObject({ code: "PROSPECTING_EVIDENCE_STALE" });
  });

  it("protege assinatura, nonce e idempotência no envelope Open-Dot", async () => {
    const secret = "integration-secret-with-at-least-thirty-two-characters";
    const requestService = createOpenDotRequestService({
      database,
      now: () => clock,
      environment: { ...process.env, OPEN_DOT_CLIENTS_JSON: JSON.stringify([{ clientId: principal.clientId, workspaceId: principal.workspaceId, actorId: principal.actorId, scopes: principal.scopes, currentSecret: secret }]) },
    });
    const path = "/api/integrations/open-dot/v1/candidates";
    const timestamp = clock.toISOString();
    const rawBody = JSON.stringify({ fixture: true });
    const invoke = (idempotencyKey: string, nonce: string, body = rawBody) => requestService.execute({
      method: "POST",
      path,
      rawBody: body,
      requiredScope: "RESEARCH_WRITE",
      rawHeaders: {
        clientId: principal.clientId,
        timestamp,
        nonce,
        idempotencyKey,
        signature: signOpenDotRequest({ secret, method: "POST", path, timestamp, nonce, rawBody: body }),
      },
      handler: async () => ({ status: 202, body: { accepted: true } }),
    });
    const first = await invoke("request-envelope-1", "nonce_integration_0000000001");
    const replay = await invoke("request-envelope-1", "nonce_integration_0000000002");
    expect(first).toMatchObject({ status: 202, idempotentReplay: false });
    expect(replay).toMatchObject({ status: 202, idempotentReplay: true });
    await expect(invoke("request-envelope-1", "nonce_integration_0000000003", JSON.stringify({ fixture: false }))).rejects.toMatchObject({ code: "OPEN_DOT_IDEMPOTENCY_CONFLICT" });
    await expect(invoke("request-envelope-2", "nonce_integration_0000000001")).rejects.toMatchObject({ code: "OPEN_DOT_NONCE_REPLAY" });
    const concurrent = await Promise.all([
      invoke("request-envelope-concurrent", "nonce_integration_concurrent_01"),
      invoke("request-envelope-concurrent", "nonce_integration_concurrent_02"),
    ]);
    expect(concurrent.map((result) => result.idempotentReplay).sort()).toEqual([false, true]);
  });

  it("libera uma vez sob concorrência, exige o gate D1 e interrompe o restante após resposta", async () => {
    const payload = candidate({
      idempotencyKey: "candidate:integration:end-to-end",
      externalIdentityKey: "tse:2024:3550308:councilor:777",
      politician: { name: "Vereadora Fluxo Completo", role: "COUNCILOR", term: "2025-2028", mandateStatus: "CURRENT", mandateVerifiedAt: "2026-10-05T12:00:00-03:00" },
      contact: { phone: "+551140001777", phoneScope: "OFFICE", email: "fluxo@camara.example.test", emailScope: "OFFICE", politicianPhone: "+5511999991776", politicianEmail: "politica.fluxo@example.test", advisorPhone: "+551140001778", advisorEmail: "assessor.fluxo@camara.example.test", whatsapp: "+5511999991777", whatsappScope: "OFFICE", instagram: "@fluxocompleto", instagramScope: "POLITICIAN" },
    });
    const ingested = await database.$transaction((transaction) => service.ingestCandidate(transaction, principal, payload));
    const planner = createProspectingPlannerService({ database, now: () => clock });
    const planned = await planner.plan(database, { workspaceId: principal.workspaceId, actorId: systemActorId, horizonStart: "2026-10-05", horizonEnd: "2026-11-03" });
    expect(planned.planned).toBeGreaterThanOrEqual(1);

    const releaseBeforeLocalDay = createProspectingReleaseService({ database, now: () => clock });
    clock = new Date("2026-10-05T00:30:00.000Z");
    await expect(releaseBeforeLocalDay.processNext("worker-before-local-day")).resolves.toMatchObject({ processed: false, outcome: "EMPTY" });
    clock = new Date("2026-10-05T15:00:00.000Z");
    let releaseClockOffsetMs = 0;
    const release = createProspectingReleaseService({ database, now: () => new Date(clock.getTime() + releaseClockOffsetMs++) });
    const firstRace = await Promise.all([release.processNext("worker-a"), release.processNext("worker-b")]);
    expect(firstRace.filter((item) => item.outcome === "RELEASED")).toHaveLength(1);
    for (let index = 0; index < 4; index += 1) {
      const state = await database.prospectCandidate.findUniqueOrThrow({ where: { id: ingested.candidate.id }, select: { status: true } });
      if (state.status === "RELEASED") break;
      await release.processNext(`worker-follow-up-${index}`);
    }
    const releasedCandidate = await database.prospectCandidate.findUniqueOrThrow({ where: { id: ingested.candidate.id } });
    expect(releasedCandidate).toMatchObject({ status: "RELEASED" });
    expect(releasedCandidate.leadId).not.toBeNull();
    const leadId = releasedCandidate.leadId!;
    const releasedLead = await database.lead.findUniqueOrThrow({ where: { id: leadId }, select: { contactId: true } });
    const releasedContactPoints = await database.contactPoint.findMany({ where: { workspaceId: principal.workspaceId, contactId: releasedLead.contactId!, deletedAt: null }, select: { type: true, label: true, normalizedValue: true } });
    expect(releasedContactPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "PHONE", label: "Político · Público" }),
      expect.objectContaining({ type: "EMAIL", label: "Político · Público" }),
      expect.objectContaining({ type: "PHONE", label: "Assessor" }),
      expect.objectContaining({ type: "EMAIL", label: "Assessor" }),
      expect.objectContaining({ type: "PHONE", label: "WhatsApp · Gabinete" }),
      expect.objectContaining({ type: "WHATSAPP", label: "Gabinete", normalizedValue: "+5511999991777" }),
      expect.objectContaining({ type: "INSTAGRAM", label: "Direto", normalizedValue: "@fluxocompleto" }),
    ]));
    const cadence = await database.prospectingCadenceInstance.findUniqueOrThrow({ where: { workspaceId_leadId: { workspaceId: principal.workspaceId, leadId } } });
    expect(cadence.status).toBe("PENDING_D1");
    expect(await database.prospectingCadenceStep.count({ where: { cadenceInstanceId: cadence.id } })).toBe(17);
    expect(await database.lead.count({ where: { workspaceId: principal.workspaceId, id: leadId } })).toBe(1);

    clock = new Date(clock.getTime() + 1_000);
    const d1Results = new Map<string, string>([["call-1", "NO_ANSWER"], ["instagram-message-1", "SENT"], ["instagram-follow", "COMPLETED"]]);
    const d1Steps = await database.prospectingCadenceStep.findMany({ where: { cadenceInstanceId: cadence.id, stepKey: { in: [...d1Results.keys()] } }, orderBy: { scheduledAt: "asc" } });
    for (const step of d1Steps) {
      const result = d1Results.get(step.stepKey);
      if (!result) throw new Error(`Resultado D1 ausente para ${step.stepKey}.`);
      await database.$transaction(async (transaction) => {
        await transaction.task.update({ where: { id: step.taskId! }, data: { status: "COMPLETED", completedAt: clock, result, updatedByActorId: systemActorId } });
        await applyProspectingTaskCompletionInTransaction(transaction, { workspaceId: principal.workspaceId, leadId, taskId: step.taskId!, result, actorId: systemActorId, completedAt: clock });
      });
    }
    expect(await database.prospectingCadenceInstance.findUniqueOrThrow({ where: { id: cadence.id } })).toMatchObject({ status: "ACTIVE" });
    expect(await database.prospectingEmailJob.count({ where: { cadenceInstanceId: cadence.id, status: "SCHEDULED" } })).toBe(7);

    const firstEmail = await database.prospectingEmailJob.findFirstOrThrow({ where: { cadenceInstanceId: cadence.id, stepKey: "email-1" } });
    clock = new Date(firstEmail.scheduledAt.getTime() + 5 * 60_000);
    const email = createProspectingEmailService({ database, now: () => clock });
    const claims = await Promise.all([
      database.$transaction((transaction) => email.claim(transaction, principal, { limit: 1, leaseSeconds: 120 })),
      database.$transaction((transaction) => email.claim(transaction, principal, { limit: 1, leaseSeconds: 120 })),
    ]);
    expect(claims.reduce((total, result) => total + result.claimed, 0)).toBe(1);
    const claimedJob = claims.flatMap((result) => result.jobs)[0]!;
    await expect(database.$transaction((transaction) => email.receipt(transaction, principal, String(claimedJob.id), { outcome: "SENT", providerMessageId: "provider-message-001", occurredAt: clock.toISOString() }))).rejects.toMatchObject({ code: "PROSPECTING_EMAIL_REVALIDATION_REQUIRED" });
    await expect(database.$transaction((transaction) => email.revalidate(transaction, principal, String(claimedJob.id)))).resolves.toMatchObject({ authorized: true });
    const sent = await database.$transaction((transaction) => email.receipt(transaction, principal, String(claimedJob.id), { outcome: "SENT", providerMessageId: "provider-message-001", occurredAt: clock.toISOString() }));
    expect(sent).toMatchObject({ duplicate: false, job: { status: "SENT" } });
    await expect(database.$transaction((transaction) => email.receipt(transaction, principal, String(claimedJob.id), { outcome: "SENT", providerMessageId: "provider-message-001", occurredAt: clock.toISOString() }))).resolves.toMatchObject({ duplicate: true });
    await database.$transaction((transaction) => email.event(transaction, principal, { externalEventId: "provider-event-delivered-001", providerMessageId: "provider-message-001", type: "DELIVERED", occurredAt: clock.toISOString() }));
    await expect(database.$transaction((transaction) => email.event(transaction, principal, { externalEventId: "provider-event-delivered-001", providerMessageId: "provider-message-001", type: "BOUNCED", occurredAt: clock.toISOString() }))).rejects.toMatchObject({ code: "PROSPECTING_EMAIL_EVENT_CONFLICT" });
    const replied = await database.$transaction((transaction) => email.event(transaction, principal, { externalEventId: "provider-event-replied-001", providerMessageId: "provider-message-001", type: "REPLIED", occurredAt: new Date(clock.getTime() + 60_000).toISOString(), automaticReply: false }));
    expect(replied).toMatchObject({ matched: true, applied: true });
    expect(await database.prospectingCadenceInstance.findUniqueOrThrow({ where: { id: cadence.id } })).toMatchObject({ status: "CONVERSATION_STARTED", stopReasonCode: "HUMAN_REPLY" });
    expect(await database.lead.findUniqueOrThrow({ where: { id: leadId } })).toMatchObject({ awaitingHumanResponse: true });
    expect(await database.task.count({ where: { workspaceId: principal.workspaceId, leadId, sourceKey: `active-prospecting:${cadence.id}:respond-human`, status: "OPEN" } })).toBe(1);
    expect(await database.prospectingEmailJob.count({ where: { cadenceInstanceId: cadence.id, status: "CANCELLED" } })).toBe(6);
  });

  it("persiste reconciliação diária idempotente, detecta invariantes e mantém RLS fechado", async () => {
    const inconsistent = await database.prospectCandidate.findFirstOrThrow({ where: { workspaceId: principal.workspaceId, status: "REVIEW_REQUIRED", leadId: null }, select: { id: true } });
    await database.prospectCandidate.update({ where: { id: inconsistent.id }, data: { status: "RELEASED" } });
    const reconciliation = createProspectingReconciliationService({ database, now: () => clock });
    await expect(reconciliation.reconcileWorkspace(principal.workspaceId, "integration:reconciliation", true)).resolves.toMatchObject({ status: "RECONCILED", health: "CRITICAL" });
    const state = await database.prospectingReconciliationState.findUniqueOrThrow({ where: { workspaceId: principal.workspaceId } });
    expect(state.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "RELEASED_CANDIDATE_WITHOUT_LEAD", severity: "CRITICAL", entityId: inconsistent.id, count: 1 }),
    ]));
    const auditCount = await database.auditLog.count({ where: { workspaceId: principal.workspaceId, action: "prospecting.reconciliation.changed", entityId: state.id } });
    await reconciliation.reconcileWorkspace(principal.workspaceId, "integration:reconciliation:replay", true);
    await expect(database.auditLog.count({ where: { workspaceId: principal.workspaceId, action: "prospecting.reconciliation.changed", entityId: state.id } })).resolves.toBe(auditCount);
    await expect(reconciliation.processNext("integration:daily-worker")).resolves.toEqual({ status: "IDLE" });
    const [security] = await database.$queryRaw<Array<{ rowSecurity: boolean; anonPrivileges: boolean; authenticatedPrivileges: boolean }>>`
      SELECT c.relrowsecurity AS "rowSecurity",
             CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
               THEN has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') ELSE FALSE END AS "anonPrivileges",
             CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
               THEN has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') ELSE FALSE END AS "authenticatedPrivileges"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname = 'prospecting_reconciliation_states'
    `;
    expect(security).toEqual({ rowSecurity: true, anonPrivileges: false, authenticatedPrivileges: false });
  });
});
