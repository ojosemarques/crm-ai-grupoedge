import { z } from "zod";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { McpAuthExtra } from "@/modules/prospecting/application/politizai-mcp-oauth-service";
import { createProspectingStagingService } from "@/modules/prospecting/application/prospecting-staging-service";
import { PROSPECTING_CONTRACT_VERSION } from "@/modules/prospecting/domain/prospecting-contracts";
import { PROSPECTING_SOURCE_SNAPSHOTS } from "@/modules/prospecting/domain/politizai-mcp-config";
import type { OpenDotPrincipal } from "@/modules/prospecting/domain/open-dot-policy";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

const LEASE_MINUTES = 45;
const AGENT_VERSION = "politizai-dot-mcp/1.0.0";
const PROMPT_VERSION = "political-prospect-production/v1";

const researchSourceSchema = z.object({
  field: z.enum(["role", "mandate", "phone", "email", "instagram"]),
  type: z.enum(["CITY_HALL", "CITY_COUNCIL", "OFFICIAL_GAZETTE", "INSTITUTIONAL_PROFILE"]),
  url: z.string().url().max(2_000),
  observedAt: z.string().datetime({ offset: true }),
  contactScope: z.enum(["POLITICIAN", "ADVISOR", "OFFICE"]).optional(),
  originalValue: z.string().trim().max(2_000).optional(),
  normalizedValue: z.string().trim().max(2_000).optional(),
  validationMethod: z.string().trim().min(3).max(160).default("OFFICIAL_SOURCE_CHECK"),
}).strict();

export const registerCandidateSchema = z.object({
  targetId: z.string().uuid(),
  leaseOwner: z.string().min(10).max(240),
  politician: z.object({
    mandateStatus: z.enum(["CURRENT", "INCONCLUSIVE"]),
    mandateVerifiedAt: z.string().datetime({ offset: true }),
  }).strict(),
  contact: z.object({
    phone: z.string().trim().min(8).max(80),
    phoneScope: z.enum(["POLITICIAN", "ADVISOR", "OFFICE"]),
    email: z.string().trim().toLowerCase().email().max(320),
    emailScope: z.enum(["POLITICIAN", "ADVISOR", "OFFICE"]),
    instagram: z.string().trim().min(2).max(160).nullable().default(null),
    instagramScope: z.enum(["POLITICIAN", "ADVISOR", "OFFICE"]).nullable().default(null),
  }).strict(),
  sources: z.array(researchSourceSchema).min(3).max(38),
}).strict();

export const inconclusiveTargetSchema = z.object({
  targetId: z.string().uuid(),
  leaseOwner: z.string().min(10).max(240),
  reasonCode: z.enum(["CAPTCHA", "CONTACT_NOT_FOUND", "CONFLICTING_SOURCES", "MUNICIPAL_SOURCE_UNAVAILABLE", "OTHER"]),
  evidence: z.array(z.object({ url: z.string().url().max(2_000), note: z.string().trim().min(3).max(500) }).strict()).max(20).default([]),
}).strict();

type Options = Readonly<{ database: PrismaClient; now: () => Date }>;

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function createPolitizaiMcpProspectingService(options: Options) {
  const staging = createProspectingStagingService({ database: options.database, now: options.now });

  async function principal(transaction: Prisma.TransactionClient, auth: McpAuthExtra, actorKey: "open-dot-research" | "open-dot-auditor"): Promise<OpenDotPrincipal> {
    const actor = await transaction.actor.findFirst({
      where: { workspaceId: auth.workspaceId, key: actorKey, type: "AI_AGENT", userId: null },
      select: { id: true },
    });
    if (!actor) fail("Ator técnico de prospecção não configurado.", "PROSPECTING_ACTOR_NOT_CONFIGURED", 503);
    return {
      clientId: "politizai-mcp",
      workspaceId: auth.workspaceId,
      actorId: actor.id,
      scopes: actorKey === "open-dot-auditor" ? ["RESEARCH_REVIEW", "RESEARCH_READ"] : ["RESEARCH_WRITE", "RESEARCH_READ"],
    };
  }

  async function getContext(auth: McpAuthExtra) {
    const [workspace, settings, sellerConfigs, targets] = await Promise.all([
      options.database.workspace.findFirst({ where: { id: auth.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true, name: true, slug: true } }),
      options.database.prospectingSettings.findUnique({ where: { workspaceId: auth.workspaceId }, select: { releaseEnabled: true, emailEgressEnabled: true } }),
      options.database.prospectingSellerConfig.findMany({
        where: { workspaceId: auth.workspaceId, active: true },
        select: { memberId: true },
        orderBy: [{ rotationPosition: "asc" }, { memberId: "asc" }],
      }),
      options.database.prospectingResearchTarget.groupBy({ by: ["status"], where: { workspaceId: auth.workspaceId }, _count: { _all: true } }),
    ]);
    if (!workspace) fail("Workspace MCP não encontrado.", "MCP_WORKSPACE_NOT_FOUND", 404);
    const activeSellerMembers = await options.database.workspaceMember.findMany({
      where: { id: { in: sellerConfigs.map((seller) => seller.memberId) }, workspaceId: auth.workspaceId, status: "ACTIVE", deletedAt: null, user: { deletedAt: null, status: "ACTIVE" } },
      select: { id: true, userId: true },
    });
    const activeSellerUsers = await options.database.user.findMany({
      where: { id: { in: activeSellerMembers.map((seller) => seller.userId) }, status: "ACTIVE", deletedAt: null },
      select: { id: true, displayName: true },
    });
    const namesByUserId = new Map(activeSellerUsers.map((user) => [user.id, user.displayName]));
    const sellersById = new Map(activeSellerMembers.flatMap((seller) => {
      const name = namesByUserId.get(seller.userId);
      return name ? [[seller.id, name] as const] : [];
    }));
    return {
      workspace,
      rules: {
        roles: ["MAYOR", "COUNCILOR"],
        minimumPopulation: 30_000,
        currentMandateRequired: true,
        verifiedPhoneAndEmailRequired: true,
        inferContactData: false,
        directLeadCreation: false,
        emailSending: false,
      },
      automation: { leadReleaseEnabled: settings?.releaseEnabled ?? false, emailEgressEnabled: settings?.emailEgressEnabled ?? false },
      sellers: sellerConfigs.flatMap((seller) => {
        const name = sellersById.get(seller.memberId);
        return name ? [{ memberId: seller.memberId, name }] : [];
      }),
      targetsByStatus: Object.fromEntries(targets.map((item) => [item.status, item._count._all])),
      sourceSnapshots: PROSPECTING_SOURCE_SNAPSHOTS,
    };
  }

  async function openBatch(auth: McpAuthExtra) {
    return options.database.$transaction(async (transaction) => {
      const researchPrincipal = await principal(transaction, auth, "open-dot-research");
      const targetWithWork = await transaction.prospectingResearchTarget.findFirst({
        where: { workspaceId: auth.workspaceId, status: { in: ["PENDING", "CLAIMED", "REVIEW_REQUIRED"] } },
        orderBy: { createdAt: "desc" },
        select: { batchId: true },
      });
      const active = targetWithWork ? await transaction.prospectingResearchBatch.findFirst({
        where: { id: targetWithWork.batchId, workspaceId: auth.workspaceId, status: { in: ["DRAFT", "RUNNING"] } },
        select: { id: true, status: true, horizonStart: true, horizonEnd: true },
      }) : null;
      if (active) return { batch: { ...active, horizonStart: isoDate(active.horizonStart), horizonEnd: isoDate(active.horizonEnd) }, reused: true };
      const start = options.now();
      const batch = await staging.createResearchBatch(transaction, researchPrincipal, {
        idempotencyKey: `dot-${isoDate(start).slice(0, 7)}-${PROSPECTING_SOURCE_SNAPSHOTS.population.hash.slice(0, 12)}`,
        horizonStart: isoDate(start),
        horizonEnd: isoDate(addDays(start, 29)),
        sourcePopulationEdition: PROSPECTING_SOURCE_SNAPSHOTS.population.edition,
        sourcePopulationHash: PROSPECTING_SOURCE_SNAPSHOTS.population.hash,
        sourcePopulationImportedAt: PROSPECTING_SOURCE_SNAPSHOTS.population.observedAt,
        sourceElectionEdition: PROSPECTING_SOURCE_SNAPSHOTS.election.edition,
        sourceElectionHash: PROSPECTING_SOURCE_SNAPSHOTS.election.hash,
        sourceElectionImportedAt: PROSPECTING_SOURCE_SNAPSHOTS.election.observedAt,
        agentVersion: AGENT_VERSION,
        promptVersion: PROMPT_VERSION,
      });
      return { ...batch, reused: false, note: "O lote precisa receber a fila oficial de alvos antes da pesquisa." };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
  }

  async function claimNextTarget(auth: McpAuthExtra, batchId?: string) {
    return options.database.$transaction(async (transaction) => {
      await principal(transaction, auth, "open-dot-research");
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`politizai-mcp-claim:${auth.workspaceId}`}, 0))`;
      const now = options.now();
      const batch = await transaction.prospectingResearchBatch.findFirst({
        where: { workspaceId: auth.workspaceId, status: { in: ["DRAFT", "RUNNING"] }, ...(batchId ? { id: batchId } : {}) },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });
      if (!batch) return { target: null, queueEmpty: true };
      const target = await transaction.prospectingResearchTarget.findFirst({
        where: {
          workspaceId: auth.workspaceId,
          batchId: batch.id,
          OR: [{ status: "PENDING" }, { status: "CLAIMED", leaseExpiresAt: { lte: now } }],
        },
        orderBy: [{ population: "desc" }, { stateCode: "asc" }, { municipalityName: "asc" }, { role: "asc" }],
      });
      if (!target) return { target: null, queueEmpty: true };
      const leaseOwner = `dot:${auth.authorizingActorId}:${crypto.randomUUID()}`;
      const leaseExpiresAt = new Date(now.getTime() + LEASE_MINUTES * 60_000);
      const claimed = await transaction.prospectingResearchTarget.update({
        where: { id: target.id },
        data: { status: "CLAIMED", leaseOwner, leaseExpiresAt, attemptCount: { increment: 1 }, lastReasonCode: null },
        select: { id: true, batchId: true, tseCandidateId: true, externalIdentityKey: true, role: true, politicianName: true, ballotName: true, municipalityName: true, municipalityIbgeCode: true, stateCode: true, population: true },
      });
      return { target: { ...claimed, leaseOwner, leaseExpiresAt: leaseExpiresAt.toISOString(), instructions: "Localize telefone e e-mail institucionais, sem inferir; valide o mandato atual em fonte municipal oficial e informe todas as fontes." }, queueEmpty: false };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
  }

  async function registerCandidate(auth: McpAuthExtra, raw: unknown) {
    const input = registerCandidateSchema.parse(raw);
    return options.database.$transaction(async (transaction) => {
      const researchPrincipal = await principal(transaction, auth, "open-dot-research");
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`politizai-target:${auth.workspaceId}:${input.targetId}`}, 0))`;
      const target = await transaction.prospectingResearchTarget.findFirst({ where: { id: input.targetId, workspaceId: auth.workspaceId } });
      const now = options.now();
      if (!target) fail("Alvo de pesquisa não encontrado.", "PROSPECTING_TARGET_NOT_FOUND", 404);
      if (target.status !== "CLAIMED" || target.leaseOwner !== input.leaseOwner || !target.leaseExpiresAt || target.leaseExpiresAt <= now) {
        fail("A concessão deste alvo expirou ou pertence a outra execução.", "PROSPECTING_TARGET_LEASE_INVALID");
      }
      const result = await staging.ingestCandidate(transaction, researchPrincipal, {
        schemaVersion: PROSPECTING_CONTRACT_VERSION,
        idempotencyKey: `dot-target-${target.id}`,
        batchId: target.batchId,
        externalIdentityKey: target.externalIdentityKey,
        politician: { name: target.politicianName, role: target.role, term: "2025-2028", ...input.politician },
        municipality: { ibgeCode: target.municipalityIbgeCode, name: target.municipalityName, stateCode: target.stateCode, population: target.population, populationEdition: PROSPECTING_SOURCE_SNAPSHOTS.population.edition },
        contact: input.contact,
        sources: [
          { field: "role", type: "TSE", url: PROSPECTING_SOURCE_SNAPSHOTS.election.url, observedAt: PROSPECTING_SOURCE_SNAPSHOTS.election.observedAt, originalValue: target.tseCandidateId, validationMethod: "TSE_RESULTADOS_2024_SQ_CANDIDATO" },
          { field: "population", type: "IBGE", url: PROSPECTING_SOURCE_SNAPSHOTS.population.url, observedAt: PROSPECTING_SOURCE_SNAPSHOTS.population.observedAt, originalValue: String(target.population), normalizedValue: String(target.population), validationMethod: "IBGE_ESTIMATIVA_2026_CODIGO_MUNICIPIO" },
          ...input.sources,
        ],
        agentVersion: AGENT_VERSION,
        promptVersion: PROMPT_VERSION,
      });
      await transaction.prospectingResearchTarget.update({
        where: { id: target.id },
        data: { status: result.candidate.status === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "INGESTED", candidateId: result.candidate.id, leaseOwner: null, leaseExpiresAt: null, completedAt: now, lastEvidence: asJson({ sourceCount: input.sources.length + 2 }) },
      });
      return result;
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
  }

  async function markInconclusive(auth: McpAuthExtra, raw: unknown) {
    const input = inconclusiveTargetSchema.parse(raw);
    return options.database.$transaction(async (transaction) => {
      const actor = await principal(transaction, auth, "open-dot-research");
      const target = await transaction.prospectingResearchTarget.findFirst({ where: { id: input.targetId, workspaceId: auth.workspaceId } });
      const now = options.now();
      if (!target) fail("Alvo de pesquisa não encontrado.", "PROSPECTING_TARGET_NOT_FOUND", 404);
      if (target.status !== "CLAIMED" || target.leaseOwner !== input.leaseOwner || !target.leaseExpiresAt || target.leaseExpiresAt <= now) fail("A concessão deste alvo expirou ou pertence a outra execução.", "PROSPECTING_TARGET_LEASE_INVALID");
      const updated = await transaction.prospectingResearchTarget.update({ where: { id: target.id }, data: { status: "SKIPPED", lastReasonCode: input.reasonCode, lastEvidence: asJson(input.evidence), leaseOwner: null, leaseExpiresAt: null, completedAt: now } });
      await transaction.auditLog.create({ data: { workspaceId: auth.workspaceId, actorId: actor.actorId, action: "prospecting.target.inconclusive", origin: "API", entityType: "ProspectingResearchTarget", entityId: target.id, changes: { status: { from: "CLAIMED", to: "SKIPPED" } }, metadata: { reasonCode: input.reasonCode, evidenceCount: input.evidence.length } } });
      return { target: { id: updated.id, status: updated.status, reasonCode: updated.lastReasonCode } };
    });
  }

  async function getBatch(auth: McpAuthExtra, batchId: string) {
    return options.database.$transaction(async (transaction) => {
      const researchPrincipal = await principal(transaction, auth, "open-dot-research");
      const [batch, targets, reviews] = await Promise.all([
        staging.getResearchBatch(transaction, researchPrincipal, batchId),
        transaction.prospectingResearchTarget.groupBy({ by: ["status"], where: { workspaceId: auth.workspaceId, batchId }, _count: { _all: true } }),
        transaction.prospectCandidate.findMany({ where: { workspaceId: auth.workspaceId, batchId, status: "REVIEW_REQUIRED" }, select: { id: true, politicianName: true, role: true, municipalityName: true, stateCode: true, revision: true, reviewReasonCode: true, sources: { select: { id: true, field: true, sourceUrl: true, sourceType: true, validationStatus: true, observedAt: true } } }, take: 25, orderBy: { createdAt: "asc" } }),
      ]);
      return { ...batch, targetsByStatus: Object.fromEntries(targets.map((item) => [item.status, item._count._all])), reviewQueue: reviews };
    });
  }

  async function reviewCandidate(auth: McpAuthExtra, candidateId: string, input: unknown) {
    return options.database.$transaction(async (transaction) => {
      const auditor = await principal(transaction, auth, "open-dot-auditor");
      const result = await staging.reviewCandidate(transaction, auditor, candidateId, input);
      await transaction.prospectingResearchTarget.updateMany({ where: { workspaceId: auth.workspaceId, candidateId }, data: { status: result.candidate.status === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "INGESTED", lastReasonCode: result.candidate.status === "READY" ? null : "AUDITOR_DECISION", completedAt: options.now() } });
      return result;
    });
  }

  async function completeBatch(auth: McpAuthExtra, batchId: string, status: "COMPLETED" | "CANCELLED" | "FAILED") {
    return options.database.$transaction(async (transaction) => {
      const researchPrincipal = await principal(transaction, auth, "open-dot-research");
      if (status === "COMPLETED") {
        const pending = await transaction.prospectingResearchTarget.count({ where: { workspaceId: auth.workspaceId, batchId, status: { in: ["PENDING", "CLAIMED", "REVIEW_REQUIRED"] } } });
        if (pending > 0) fail(`O lote ainda possui ${pending} alvo(s) pendente(s).`, "PROSPECTING_BATCH_TARGETS_PENDING");
      }
      return staging.completeResearchBatch(transaction, researchPrincipal, batchId, { status });
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
  }

  return Object.freeze({ getContext, openBatch, claimNextTarget, registerCandidate, markInconclusive, getBatch, reviewCandidate, completeBatch });
}

let singleton: ReturnType<typeof createPolitizaiMcpProspectingService> | undefined;
export function getPolitizaiMcpProspectingService() {
  singleton ??= createPolitizaiMcpProspectingService({ database: getDatabaseClient(), now: () => new Date() });
  return singleton;
}
