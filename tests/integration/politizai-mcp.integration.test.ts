import { createHash } from "node:crypto";

import { OAuthErrorCode } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createPolitizaiMcpOAuthService } from "@/modules/prospecting/application/politizai-mcp-oauth-service";
import { createPolitizaiMcpProspectingService } from "@/modules/prospecting/application/politizai-mcp-prospecting-service";
import { POLITIZAI_MCP_CALLBACK_CLIENT_ID, POLITIZAI_MCP_CALLBACK_REDIRECT_URI, getPolitizaiMcpPublicConfig } from "@/modules/prospecting/domain/politizai-mcp-config";
import { ensureProductionFoundationInTransaction } from "@/modules/settings/application/production-foundation-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for Politizai MCP integration tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 5 }) });
const clock = new Date("2026-10-06T15:00:00.000Z");
const secret = "politizai-mcp-integration-signing-secret-with-more-than-32-chars";
let counter = 0;
const oauth = createPolitizaiMcpOAuthService({ database, now: () => clock, generateOpaqueToken: () => `opaque-token-${String(++counter).padStart(40, "0")}`, signingSecret: () => secret });
const prospecting = createPolitizaiMcpProspectingService({ database, now: () => clock });
let context: AuthenticatedContext;

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" });
  await database.$transaction((transaction) => ensureProductionFoundationInTransaction(transaction, "politizai"));
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: seeded.workspaceId, status: "ACTIVE", deletedAt: null }, include: { user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: seeded.workspaceId, userId: member.userId, type: "HUMAN" } });
  context = {
    workspaceId: seeded.workspaceId,
    workspaceSlug: "politizai",
    sessionId: crypto.randomUUID(),
    userId: member.userId,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: member.user.displayName,
  };
});

afterAll(async () => { await database.$disconnect(); });

describe("MCP privado Politizai", () => {
  it("aplica PKCE, uso único, audience e rotação do refresh token", async () => {
    const verifier = "v".repeat(64);
    const resource = getPolitizaiMcpPublicConfig().resource.href;
    const request = oauth.parseAuthorizationRequest({
      response_type: "code",
      client_id: POLITIZAI_MCP_CALLBACK_CLIENT_ID,
      redirect_uri: POLITIZAI_MCP_CALLBACK_REDIRECT_URI,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: "integration-state",
      resource,
      scope: "prospecting:read prospecting:research prospecting:review",
    });
    const code = await oauth.createAuthorizationCode(context, request);
    const first = await oauth.exchangeAuthorizationCode({ code, codeVerifier: verifier, clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID, redirectUri: POLITIZAI_MCP_CALLBACK_REDIRECT_URI, resource });
    await expect(oauth.exchangeAuthorizationCode({ code, codeVerifier: verifier, clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID, redirectUri: POLITIZAI_MCP_CALLBACK_REDIRECT_URI, resource })).rejects.toMatchObject({ code: OAuthErrorCode.InvalidGrant });
    await expect(oauth.verifyAccessToken(first.access_token)).resolves.toMatchObject({ clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID, scopes: ["prospecting:read", "prospecting:research", "prospecting:review"] });
    const rotated = await oauth.refreshAccessToken({ refreshToken: first.refresh_token, clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID, resource });
    await expect(oauth.refreshAccessToken({ refreshToken: first.refresh_token, clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID, resource })).rejects.toMatchObject({ code: OAuthErrorCode.InvalidGrant });
    await expect(oauth.verifyAccessToken(rotated.access_token)).resolves.toMatchObject({ resource: new URL(resource) });
    await expect(oauth.refreshAccessToken({ refreshToken: rotated.refresh_token, clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID, resource: "https://outro.example/mcp" })).rejects.toMatchObject({ code: OAuthErrorCode.InvalidGrant });
  });

  it("concede um alvo por vez e registra apenas no estoque, sem Lead nem e-mail", async () => {
    const opened = await prospecting.openBatch({ workspaceId: context.workspaceId, userId: context.userId, memberId: context.memberId, authorizingActorId: context.actorId });
    const batchId = opened.batch.id;
    await database.prospectingResearchTarget.create({ data: { workspaceId: context.workspaceId, batchId, externalIdentityKey: "tse-2024:integration-mayor-1", tseCandidateId: "integration-mayor-1", role: "MAYOR", politicianName: "Prefeita Integração", ballotName: "Prefeita Integração", municipalityName: "Cidade Integração", municipalityIbgeCode: "3550308", stateCode: "SP", population: 1_000_000 } });
    const [leadCountBefore, emailJobCountBefore] = await Promise.all([
      database.lead.count({ where: { workspaceId: context.workspaceId } }),
      database.prospectingEmailJob.count({ where: { workspaceId: context.workspaceId } }),
    ]);
    const auth = { workspaceId: context.workspaceId, userId: context.userId, memberId: context.memberId, authorizingActorId: context.actorId };
    const claim = await prospecting.claimNextTarget(auth, batchId);
    expect(claim).toMatchObject({ queueEmpty: false, target: { politicianName: "Prefeita Integração" } });
    await expect(prospecting.claimNextTarget(auth, batchId)).resolves.toEqual({ target: null, queueEmpty: true });
    const target = claim.target!;
    const ingested = await prospecting.registerCandidate(auth, {
      targetId: target.id,
      leaseOwner: target.leaseOwner,
      politician: { mandateStatus: "CURRENT", mandateVerifiedAt: "2026-10-06T11:00:00-03:00" },
      contact: { phone: "+551140001234", phoneScope: "OFFICE" },
      researchChecks: {
        municipalOffice: { status: "INDIVIDUAL_CONTACTS_CAPTURED", url: "https://prefeitura.sp.gov.br/contato", checkedAt: "2026-10-06T11:00:00-03:00" },
        tse2024Candidate: { status: "CONTACTS_NOT_PUBLIC", url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2024", checkedAt: "2026-10-06T11:00:00-03:00" },
        instagram: { status: "PROFILE_NOT_FOUND", checkedAt: "2026-10-06T11:00:00-03:00" },
      },
      sources: [
        { field: "role", type: "TSE", url: "https://resultados.tse.jus.br/oficial/app/index.html#/eleicao/619", observedAt: "2026-10-06T11:00:00-03:00" },
        { field: "role", type: "CITY_HALL", url: "https://prefeitura.sp.gov.br/prefeita", observedAt: "2026-10-06T11:00:00-03:00", validationMethod: "OFFICIAL_SOURCE_CHECK" },
        { field: "mandate", type: "CITY_HALL", url: "https://prefeitura.sp.gov.br/prefeita", observedAt: "2026-10-06T11:00:00-03:00", validationMethod: "OFFICIAL_SOURCE_CHECK" },
        { field: "phone", type: "CITY_HALL", url: "https://prefeitura.sp.gov.br/contato", observedAt: "2026-10-06T11:00:00-03:00", validationMethod: "OFFICIAL_SOURCE_CHECK" },
      ],
    });
    expect(ingested).toMatchObject({ duplicate: false, candidate: { status: "READY" } });
    await expect(database.prospectCandidate.findUniqueOrThrow({ where: { id: ingested.candidate.id }, select: { normalizedPhone: true, normalizedEmail: true } })).resolves.toEqual({
      normalizedPhone: "+551140001234",
      normalizedEmail: null,
    });
    await expect(database.lead.count({ where: { workspaceId: context.workspaceId } })).resolves.toBe(leadCountBefore);
    await expect(database.prospectingEmailJob.count({ where: { workspaceId: context.workspaceId } })).resolves.toBe(emailJobCountBefore);

    const [source, pipeline, queue] = await Promise.all([
      database.leadSource.findFirstOrThrow({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true } }),
      database.pipeline.findFirstOrThrow({ where: { workspaceId: context.workspaceId, entityType: "LEAD", deletedAt: null }, select: { id: true } }),
      database.queue.findFirstOrThrow({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true } }),
    ]);
    const stage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId: context.workspaceId, pipelineId: pipeline.id, deletedAt: null }, orderBy: { position: "asc" }, select: { id: true } });
    const contact = await database.contact.create({ data: { workspaceId: context.workspaceId, preferredName: "Contato enriquecido", origin: "MANUAL", createdByActorId: context.actorId, updatedByActorId: context.actorId } });
    const existingLead = await database.lead.create({ data: { workspaceId: context.workspaceId, contactId: contact.id, sourceId: source.id, pipelineId: pipeline.id, currentStageId: stage.id, queueId: queue.id, routingQueueId: queue.id, fullName: "Contato enriquecido", slaStartedAt: clock, slaDueAt: clock, lastActivityAt: clock, createdByActorId: context.actorId, updatedByActorId: context.actorId }, select: { id: true, contactId: true } });
    await database.prospectCandidate.update({ where: { id: ingested.candidate.id }, data: { leadId: existingLead.id } });
    await database.prospectingResearchTarget.update({ where: { id: target.id }, data: { status: "PENDING", completedAt: null, lastReasonCode: "SHARED_PHONE_ENRICHMENT" } });
    const enrichmentTarget = (await prospecting.claimNextTarget(auth, batchId)).target!;
    expect(enrichmentTarget).toMatchObject({ id: target.id, candidateId: ingested.candidate.id, mode: "ENRICH_EXISTING_CANDIDATE" });
    const enrichmentPayload = {
      targetId: enrichmentTarget.id,
      leaseOwner: enrichmentTarget.leaseOwner,
      politician: { mandateStatus: "CURRENT", mandateVerifiedAt: "2026-10-06T12:00:00-03:00" },
      contact: { politicianPhone: "+5511999991234", politicianEmail: "prefeita@example.com" },
      researchChecks: {
        municipalOffice: { status: "SHARED_CONTACT_ONLY", url: "https://prefeitura.sp.gov.br/contato", checkedAt: "2026-10-06T12:00:00-03:00" },
        tse2024Candidate: { status: "CONTACTS_CAPTURED", url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2024", checkedAt: "2026-10-06T12:00:00-03:00" },
        instagram: { status: "PROFILE_NOT_FOUND", checkedAt: "2026-10-06T12:00:00-03:00" },
      },
      sources: [
        { field: "role", type: "TSE", url: "https://resultados.tse.jus.br/oficial/app/index.html#/eleicao/619", observedAt: "2026-10-06T12:00:00-03:00" },
        { field: "mandate", type: "CITY_HALL", url: "https://prefeitura.sp.gov.br/prefeita", observedAt: "2026-10-06T12:00:00-03:00" },
        { field: "politician_phone", type: "TSE", url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2024", observedAt: "2026-10-06T12:00:00-03:00", originalValue: "+5511999991234" },
        { field: "politician_email", type: "TSE", url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2024", observedAt: "2026-10-06T12:00:00-03:00", originalValue: "prefeita@example.com" },
      ],
    };
    const enriched = await prospecting.registerCandidate(auth, enrichmentPayload);
    expect(enriched).toMatchObject({ enriched: true, candidate: { id: ingested.candidate.id, status: "READY" } });
    await expect(prospecting.registerCandidate(auth, enrichmentPayload)).resolves.toMatchObject({ duplicate: true, enriched: true, candidate: { id: ingested.candidate.id } });
    await expect(database.prospectCandidate.findUniqueOrThrow({ where: { id: ingested.candidate.id }, select: { normalizedPhone: true, normalizedPoliticianPhone: true, politicianEmail: true } })).resolves.toEqual({
      normalizedPhone: "+551140001234",
      normalizedPoliticianPhone: "+5511999991234",
      politicianEmail: "prefeita@example.com",
    });
    await expect(database.contactPoint.findFirst({ where: { workspaceId: context.workspaceId, contactId: existingLead.contactId!, type: "PHONE", normalizedValue: "+5511999991234", deletedAt: null }, select: { verificationStatus: true, quality: true } })).resolves.toEqual({ verificationStatus: "VERIFIED", quality: "VALID" });

    await database.prospectingResearchTarget.create({ data: { workspaceId: context.workspaceId, batchId, externalIdentityKey: "tse-2024:integration-mayor-2", tseCandidateId: "integration-mayor-2", role: "MAYOR", politicianName: "Outro Prefeito Integração", ballotName: "Outro Prefeito", municipalityName: "Cidade Integração", municipalityIbgeCode: "3550308", stateCode: "SP", population: 1_000_000 } });
    const duplicatePhoneTarget = (await prospecting.claimNextTarget(auth, batchId)).target!;
    await expect(prospecting.registerCandidate(auth, {
      targetId: duplicatePhoneTarget.id,
      leaseOwner: duplicatePhoneTarget.leaseOwner,
      politician: { mandateStatus: "CURRENT", mandateVerifiedAt: "2026-10-06T11:00:00-03:00" },
      contact: { phone: "+551140001234", phoneScope: "OFFICE" },
      researchChecks: {
        municipalOffice: { status: "INDIVIDUAL_CONTACTS_CAPTURED", url: "https://prefeitura.sp.gov.br/outro-gabinete", checkedAt: "2026-10-06T11:00:00-03:00" },
        tse2024Candidate: { status: "CONTACTS_NOT_PUBLIC", url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2024", checkedAt: "2026-10-06T11:00:00-03:00" },
        instagram: { status: "PROFILE_NOT_FOUND", checkedAt: "2026-10-06T11:00:00-03:00" },
      },
      sources: [
        { field: "mandate", type: "CITY_HALL", url: "https://prefeitura.sp.gov.br/outro-prefeito", observedAt: "2026-10-06T11:00:00-03:00" },
        { field: "phone", type: "CITY_HALL", url: "https://prefeitura.sp.gov.br/outro-gabinete", observedAt: "2026-10-06T11:00:00-03:00", contactScope: "OFFICE" },
        { field: "role", type: "TSE", url: "https://resultados.tse.jus.br/oficial/app/index.html#/eleicao/619", observedAt: "2026-10-06T11:00:00-03:00" },
      ],
    })).rejects.toMatchObject({ code: "PROSPECTING_SHARED_OFFICE_PHONE" });
  });

  it("prioriza cidade menor e vereador e consulta o lote sem exigir argumento", async () => {
    const auth = { workspaceId: context.workspaceId, userId: context.userId, memberId: context.memberId, authorizingActorId: context.actorId };
    const opened = await prospecting.openBatch(auth);
    const batchId = opened.batch.id;
    await database.prospectingResearchTarget.createMany({ data: [
      { workspaceId: context.workspaceId, batchId, externalIdentityKey: "tse-2024:priority-capital", tseCandidateId: "priority-capital", role: "COUNCILOR", politicianName: "Vereador Capital", municipalityName: "Palmas", municipalityIbgeCode: "1721000", stateCode: "TO", population: 30_001 },
      { workspaceId: context.workspaceId, batchId, externalIdentityKey: "tse-2024:priority-mayor", tseCandidateId: "priority-mayor", role: "MAYOR", politicianName: "Prefeito Cidade Menor", municipalityName: "Cidade Menor", municipalityIbgeCode: "3500105", stateCode: "SP", population: 30_001 },
      { workspaceId: context.workspaceId, batchId, externalIdentityKey: "tse-2024:priority-councilor", tseCandidateId: "priority-councilor", role: "COUNCILOR", politicianName: "Vereador Cidade Menor", municipalityName: "Cidade Menor", municipalityIbgeCode: "3500105", stateCode: "SP", population: 30_001 },
      { workspaceId: context.workspaceId, batchId, externalIdentityKey: "tse-2024:priority-large-non-capital", tseCandidateId: "priority-large-non-capital", role: "COUNCILOR", politicianName: "Vereador Cidade Grande", municipalityName: "Cidade Grande", municipalityIbgeCode: "3500204", stateCode: "SP", population: 1_000_000 },
    ] });
    await expect(prospecting.getBatch(auth)).resolves.toMatchObject({ batch: { id: batchId } });
    const councilor = await prospecting.claimNextTarget(auth, batchId);
    expect(councilor).toMatchObject({ target: { politicianName: "Vereador Cidade Menor", role: "COUNCILOR", population: 30_001 } });
    await prospecting.markInconclusive(auth, { targetId: councilor.target!.id, leaseOwner: councilor.target!.leaseOwner, reasonCode: "CONTACT_NOT_FOUND", evidence: [] });
    const mayor = await prospecting.claimNextTarget(auth, batchId);
    expect(mayor).toMatchObject({ target: { politicianName: "Prefeito Cidade Menor", role: "MAYOR", population: 30_001 } });
    await prospecting.markInconclusive(auth, { targetId: mayor.target!.id, leaseOwner: mayor.target!.leaseOwner, reasonCode: "CONTACT_NOT_FOUND", evidence: [] });
    const largeNonCapital = await prospecting.claimNextTarget(auth, batchId);
    expect(largeNonCapital).toMatchObject({ target: { politicianName: "Vereador Cidade Grande", municipalityName: "Cidade Grande" } });
  });

  it("mantém RLS e privilégios fechados nas três tabelas novas", async () => {
    const rows = await database.$queryRaw<Array<{ tableName: string; rowSecurity: boolean; anonPrivileges: boolean; authenticatedPrivileges: boolean }>>`
      SELECT c.relname AS "tableName", c.relrowsecurity AS "rowSecurity",
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') ELSE FALSE END AS "anonPrivileges",
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') ELSE FALSE END AS "authenticatedPrivileges"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname IN ('prospecting_research_targets', 'mcp_oauth_authorization_codes', 'mcp_oauth_refresh_tokens')
      ORDER BY c.relname
    `;
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ rowSecurity: true, anonPrivileges: false, authenticatedPrivileges: false })]));
  });
});
