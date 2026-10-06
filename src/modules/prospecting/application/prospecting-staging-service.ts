import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { normalizePhone } from "@/modules/leads/domain/phone-normalizer";
import type { OpenDotPrincipal } from "@/modules/prospecting/domain/open-dot-policy";
import { sha256 } from "@/modules/prospecting/domain/open-dot-policy";
import {
  candidateFingerprint,
  candidateReviewInputSchema,
  canonicalSourceUrl,
  prospectCandidateInputSchema,
  researchBatchCompletionSchema,
  researchBatchInputSchema,
} from "@/modules/prospecting/domain/prospecting-contracts";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function createProspectingStagingService(options: Readonly<{ database: PrismaClient; now: () => Date }>) {
  async function createResearchBatch(database: Prisma.TransactionClient, principal: OpenDotPrincipal, raw: unknown) {
    const input = researchBatchInputSchema.parse(raw);
    const populationImportedAt = new Date(input.sourcePopulationImportedAt);
    const electionImportedAt = new Date(input.sourceElectionImportedAt);
    if (populationImportedAt > options.now() || electionImportedAt > options.now()) {
      fail("A data de importação das fontes não pode estar no futuro.", "PROSPECTING_SOURCE_IMPORT_IN_FUTURE", 400);
    }
    const existing = await database.prospectingResearchBatch.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId: principal.workspaceId, idempotencyKey: input.idempotencyKey } },
      select: { id: true, status: true, horizonStart: true, horizonEnd: true, sourcePopulationEdition: true, sourcePopulationHash: true, sourcePopulationImportedAt: true, sourceElectionEdition: true, sourceElectionHash: true, sourceElectionImportedAt: true, agentVersion: true, promptVersion: true },
    });
    if (existing) {
      if (
        existing.horizonStart.toISOString().slice(0, 10) !== input.horizonStart
        || existing.horizonEnd.toISOString().slice(0, 10) !== input.horizonEnd
        || existing.sourcePopulationEdition !== input.sourcePopulationEdition
        || existing.sourcePopulationHash !== input.sourcePopulationHash
        || existing.sourcePopulationImportedAt?.toISOString() !== populationImportedAt.toISOString()
        || existing.sourceElectionEdition !== input.sourceElectionEdition
        || existing.sourceElectionHash !== input.sourceElectionHash
        || existing.sourceElectionImportedAt?.toISOString() !== electionImportedAt.toISOString()
        || existing.agentVersion !== input.agentVersion
        || existing.promptVersion !== input.promptVersion
      ) fail("A chave idempotente do lote já foi usada por outro payload.", "PROSPECTING_IDEMPOTENCY_CONFLICT");
      return { batch: { ...existing, horizonStart: existing.horizonStart.toISOString().slice(0, 10), horizonEnd: existing.horizonEnd.toISOString().slice(0, 10) } };
    }
    const batch = await database.prospectingResearchBatch.create({
      data: {
        workspaceId: principal.workspaceId,
        status: "RUNNING",
        horizonStart: dateOnly(input.horizonStart),
        horizonEnd: dateOnly(input.horizonEnd),
        sourcePopulationEdition: input.sourcePopulationEdition,
        sourcePopulationHash: input.sourcePopulationHash,
        sourcePopulationImportedAt: populationImportedAt,
        sourceElectionEdition: input.sourceElectionEdition,
        sourceElectionHash: input.sourceElectionHash,
        sourceElectionImportedAt: electionImportedAt,
        agentVersion: input.agentVersion,
        promptVersion: input.promptVersion,
        idempotencyKey: input.idempotencyKey,
        startedAt: options.now(),
        createdByActorId: principal.actorId,
      },
      select: { id: true, status: true, horizonStart: true, horizonEnd: true },
    });
    return { batch: { ...batch, horizonStart: batch.horizonStart.toISOString().slice(0, 10), horizonEnd: batch.horizonEnd.toISOString().slice(0, 10) } };
  }

  async function ingestCandidate(database: Prisma.TransactionClient, principal: OpenDotPrincipal, raw: unknown) {
    const input = prospectCandidateInputSchema.parse(raw);
    await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prospect-candidate:${principal.workspaceId}:${input.externalIdentityKey}`}, 0))`;
    const batch = await database.prospectingResearchBatch.findFirst({
      where: { id: input.batchId, workspaceId: principal.workspaceId, status: { in: ["DRAFT", "RUNNING"] } },
      select: { id: true, sourcePopulationEdition: true },
    });
    if (!batch) fail("Lote de pesquisa não encontrado ou encerrado.", "PROSPECTING_BATCH_NOT_OPEN", 404);
    if (batch.sourcePopulationEdition !== input.municipality.populationEdition) {
      fail("A edição populacional do candidato difere da edição fixada no lote.", "PROSPECTING_POPULATION_EDITION_MISMATCH");
    }
    const phone = normalizePhone(input.contact.phone);
    if (!phone.success) fail(phone.message, "PROSPECTING_PHONE_INVALID", 400);
    const advisorPhone = input.contact.advisorPhone ? normalizePhone(input.contact.advisorPhone) : null;
    if (advisorPhone && !advisorPhone.success) fail(advisorPhone.message, "PROSPECTING_ADVISOR_PHONE_INVALID", 400);
    const whatsapp = input.contact.whatsapp ? normalizePhone(input.contact.whatsapp) : null;
    if (whatsapp && !whatsapp.success) fail(whatsapp.message, "PROSPECTING_WHATSAPP_INVALID", 400);
    const fingerprint = candidateFingerprint(input);
    const idempotent = await database.prospectCandidate.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId: principal.workspaceId, idempotencyKey: input.idempotencyKey } },
      select: { id: true, externalIdentityKey: true, fingerprint: true, status: true, revision: true },
    });
    if (idempotent) {
      if (idempotent.externalIdentityKey !== input.externalIdentityKey || idempotent.fingerprint !== fingerprint) {
        fail("A chave idempotente já foi usada por outro payload.", "PROSPECTING_IDEMPOTENCY_CONFLICT");
      }
      return { candidate: { id: idempotent.id, fingerprint: idempotent.fingerprint, status: idempotent.status, revision: idempotent.revision }, duplicate: true };
    }
    const existing = await database.prospectCandidate.findUnique({
      where: { workspaceId_externalIdentityKey: { workspaceId: principal.workspaceId, externalIdentityKey: input.externalIdentityKey } },
      select: { id: true, fingerprint: true, status: true, revision: true },
    });
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        fail("A identidade política já existe com evidências de contato diferentes.", "PROSPECTING_IDENTITY_CONFLICT");
      }
      await database.prospectingResearchBatch.update({ where: { id: batch.id }, data: { duplicateCount: { increment: 1 } } });
      return { candidate: existing, duplicate: true };
    }
    const [blockedPoint, blockedEmail] = await Promise.all([
      database.contactPoint.findFirst({
        where: { workspaceId: principal.workspaceId, normalizedValue: { in: [phone.normalizedPhone, input.contact.email, advisorPhone?.success ? advisorPhone.normalizedPhone : null, input.contact.advisorEmail, whatsapp?.success ? whatsapp.normalizedPhone : null].filter((value): value is string => Boolean(value)) }, doNotContact: true, deletedAt: null },
        select: { id: true },
      }),
      database.emailSuppression.findFirst({
        where: { workspaceId: principal.workspaceId, normalizedEmail: { in: [input.contact.email, input.contact.advisorEmail].filter((value): value is string => Boolean(value)) }, action: "APPLIED" },
        orderBy: { effectiveAt: "desc" },
        select: { id: true },
      }),
    ]);
    const blocked = Boolean(blockedPoint || blockedEmail);
    const freshnessCutoff = new Date(options.now().getTime() - 30 * 86_400_000);
    const mandateVerifiedAt = new Date(input.politician.mandateVerifiedAt);
    const hasFreshMunicipalEvidence = input.sources.some((source) =>
      (source.field === "role" || source.field === "mandate")
      && ["CITY_HALL", "CITY_COUNCIL", "OFFICIAL_GAZETTE"].includes(source.type)
      && new Date(source.observedAt) >= freshnessCutoff
      && new Date(source.observedAt) <= options.now(),
    );
    const staleMandate = mandateVerifiedAt < freshnessCutoff || mandateVerifiedAt > options.now() || !hasFreshMunicipalEvidence;
    const requiresMandateReview = input.politician.mandateStatus === "INCONCLUSIVE" || staleMandate;
    const candidate = await database.prospectCandidate.create({
      data: {
        workspaceId: principal.workspaceId,
        batchId: batch.id,
        externalIdentityKey: input.externalIdentityKey,
        idempotencyKey: input.idempotencyKey,
        status: blocked ? "REJECTED" : requiresMandateReview ? "REVIEW_REQUIRED" : "READY",
        politicianName: input.politician.name,
        role: input.politician.role,
        mandate: input.politician.term,
        municipalityName: input.municipality.name,
        municipalityIbgeCode: input.municipality.ibgeCode,
        stateCode: input.municipality.stateCode,
        population: input.municipality.population,
        populationEdition: input.municipality.populationEdition,
        phone: input.contact.phone,
        normalizedPhone: phone.normalizedPhone,
        phoneScope: input.contact.phoneScope,
        email: input.contact.email,
        normalizedEmail: input.contact.email,
        emailScope: input.contact.emailScope,
        advisorPhone: input.contact.advisorPhone,
        normalizedAdvisorPhone: advisorPhone?.success ? advisorPhone.normalizedPhone : null,
        advisorEmail: input.contact.advisorEmail,
        normalizedAdvisorEmail: input.contact.advisorEmail,
        whatsapp: input.contact.whatsapp,
        normalizedWhatsapp: whatsapp?.success ? whatsapp.normalizedPhone : null,
        whatsappScope: input.contact.whatsappScope,
        instagram: input.contact.instagram,
        instagramScope: input.contact.instagramScope,
        mandateVerifiedAt,
        fingerprint,
        rejectionReasonCode: blocked ? "DO_NOT_CONTACT" : null,
        reviewReasonCode: !blocked && requiresMandateReview ? staleMandate ? "MANDATE_EVIDENCE_STALE" : "MANDATE_INCONCLUSIVE" : null,
      },
      select: { id: true, status: true, revision: true },
    });
    await database.prospectCandidateSource.createMany({
      data: input.sources.map((source) => {
        const canonicalUrl = canonicalSourceUrl(source.url);
        return {
          workspaceId: principal.workspaceId,
          candidateId: candidate.id,
          field: source.field,
          sourceUrl: source.url,
          canonicalUrl,
          sourceDomain: new URL(canonicalUrl).hostname,
          sourceType: source.type,
          contactScope: source.contactScope ?? null,
          originalValue: source.originalValue ?? null,
          normalizedValue: source.normalizedValue ?? null,
          validationMethod: source.validationMethod,
          validationStatus: "VALID" as const,
          evidenceHash: sha256(JSON.stringify({ field: source.field, url: canonicalUrl, value: source.normalizedValue ?? source.originalValue ?? null })),
          observedAt: new Date(source.observedAt),
          agentVersion: input.agentVersion,
          promptVersion: input.promptVersion,
        };
      }),
    });
    await database.prospectingResearchBatch.update({
      where: { id: batch.id },
      data: {
        researchedCount: { increment: 1 },
        ...(blocked ? { rejectedCount: { increment: 1 } } : requiresMandateReview ? {} : { completeCount: { increment: 1 } }),
      },
    });
    return { candidate, duplicate: false };
  }

  async function reviewCandidate(database: Prisma.TransactionClient, principal: OpenDotPrincipal, candidateId: string, raw: unknown) {
    const input = candidateReviewInputSchema.parse(raw);
    const candidate = await database.prospectCandidate.findFirst({
      where: { id: candidateId, workspaceId: principal.workspaceId },
      select: { id: true, revision: true, status: true, rejectionReasonCode: true, mandateVerifiedAt: true, role: true, normalizedPhone: true, normalizedEmail: true },
    });
    if (!candidate) fail("Candidato não encontrado.", "PROSPECTING_CANDIDATE_NOT_FOUND", 404);
    if (candidate.revision !== input.expectedRevision) fail("O candidato foi alterado por outra revisão.", "PROSPECTING_REVISION_CONFLICT");
    if (["PLANNED", "RELEASED"].includes(candidate.status)) fail("Candidato planejado ou liberado não pode ser reaberto pela revisão.", "PROSPECTING_CANDIDATE_REVIEW_CLOSED");
    if (input.status === "READY" && candidate.rejectionReasonCode === "DO_NOT_CONTACT") fail("Bloqueio de contato não pode ser revertido pela revisão.", "PROSPECTING_DO_NOT_CONTACT_ACTIVE");
    for (const decision of input.sourceDecisions) {
      const updated = await database.prospectCandidateSource.updateMany({
        where: { id: decision.sourceId, candidateId, workspaceId: principal.workspaceId },
        data: { validationStatus: decision.status },
      });
      if (updated.count !== 1) fail("Fonte da revisão não encontrada.", "PROSPECTING_SOURCE_NOT_FOUND", 404);
    }
    if (input.status === "READY") {
      const [sources, blockedPoint, blockedEmail] = await Promise.all([
        database.prospectCandidateSource.findMany({
          where: { candidateId, workspaceId: principal.workspaceId },
          select: { field: true, sourceType: true, validationStatus: true, observedAt: true },
        }),
        database.contactPoint.findFirst({
          where: { workspaceId: principal.workspaceId, normalizedValue: { in: [candidate.normalizedPhone, candidate.normalizedEmail] }, doNotContact: true, deletedAt: null },
          select: { id: true },
        }),
        database.emailSuppression.findFirst({
          where: { workspaceId: principal.workspaceId, normalizedEmail: candidate.normalizedEmail, action: "APPLIED" },
          orderBy: { effectiveAt: "desc" },
          select: { id: true },
        }),
      ]);
      if (blockedPoint || blockedEmail) fail("Existe supressão de contato ativa para o candidato.", "PROSPECTING_DO_NOT_CONTACT_ACTIVE");
      if (sources.some((source) => source.validationStatus !== "VALID")) fail("Todas as fontes precisam estar válidas antes de READY.", "PROSPECTING_EVIDENCE_INCOMPLETE");
      const now = options.now();
      const freshnessCutoff = new Date(now.getTime() - 30 * 86_400_000);
      const municipalTypes = candidate.role === "MAYOR" ? ["CITY_HALL", "OFFICIAL_GAZETTE"] : ["CITY_COUNCIL", "OFFICIAL_GAZETTE"];
      const freshMandate = candidate.mandateVerifiedAt >= freshnessCutoff
        && candidate.mandateVerifiedAt <= now
        && sources.some((source) => (source.field === "role" || source.field === "mandate") && municipalTypes.includes(source.sourceType) && source.observedAt >= freshnessCutoff && source.observedAt <= now);
      if (!freshMandate) fail("A evidência municipal do mandato precisa estar atualizada antes de READY.", "PROSPECTING_EVIDENCE_STALE");
    }
    const updated = await database.prospectCandidate.update({
      where: { id: candidate.id },
      data: {
        status: input.status,
        revision: { increment: 1 },
        reviewReasonCode: input.status === "REVIEW_REQUIRED" ? input.reasonCode : null,
        rejectionReasonCode: input.status === "REJECTED" ? input.reasonCode : null,
      },
      select: { id: true, status: true, revision: true },
    });
    return { candidate: updated };
  }

  async function getResearchBatch(database: Prisma.TransactionClient, principal: OpenDotPrincipal, batchId: string) {
    const batch = await database.prospectingResearchBatch.findFirst({
      where: { id: batchId, workspaceId: principal.workspaceId },
      select: {
        id: true, status: true, horizonStart: true, horizonEnd: true, sourcePopulationEdition: true, sourcePopulationHash: true,
        agentVersion: true, promptVersion: true, startedAt: true, completedAt: true,
        researchedCount: true, completeCount: true, rejectedCount: true, duplicateCount: true, releasedCount: true,
      },
    });
    if (!batch) fail("Lote não encontrado.", "PROSPECTING_BATCH_NOT_FOUND", 404);
    const grouped = await database.prospectCandidate.groupBy({
      by: ["status"], where: { workspaceId: principal.workspaceId, batchId }, _count: { _all: true },
    });
    return {
      batch: {
        ...batch,
        horizonStart: batch.horizonStart.toISOString().slice(0, 10),
        horizonEnd: batch.horizonEnd.toISOString().slice(0, 10),
        candidatesByStatus: Object.fromEntries(grouped.map((item) => [item.status, item._count._all])),
      },
    };
  }

  async function completeResearchBatch(database: Prisma.TransactionClient, principal: OpenDotPrincipal, batchId: string, raw: unknown) {
    const input = researchBatchCompletionSchema.parse(raw);
    await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prospecting-batch:${principal.workspaceId}:${batchId}`}, 0))`;
    const batch = await database.prospectingResearchBatch.findFirst({ where: { id: batchId, workspaceId: principal.workspaceId } });
    if (!batch) fail("Lote não encontrado.", "PROSPECTING_BATCH_NOT_FOUND", 404);
    if (["COMPLETED", "CANCELLED", "FAILED"].includes(batch.status)) {
      if (batch.status !== input.status) fail("O lote já foi encerrado com outro estado.", "PROSPECTING_BATCH_ALREADY_CLOSED");
      return { batch: { id: batch.id, status: batch.status, completedAt: batch.completedAt?.toISOString() ?? null }, duplicate: true };
    }
    const updated = await database.prospectingResearchBatch.update({
      where: { id: batch.id },
      data: { status: input.status, completedAt: options.now() },
      select: { id: true, status: true, completedAt: true },
    });
    return { batch: { ...updated, completedAt: updated.completedAt?.toISOString() ?? null }, duplicate: false };
  }

  return Object.freeze({ createResearchBatch, ingestCandidate, reviewCandidate, getResearchBatch, completeResearchBatch });
}

let singleton: ReturnType<typeof createProspectingStagingService> | undefined;
export function getProspectingStagingService() {
  singleton ??= createProspectingStagingService({ database: getDatabaseClient(), now: () => new Date() });
  return singleton;
}
