import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { createSalesGateService } from "@/modules/opportunities/application/sales-gate-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for consultative sales gate tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 16 }) });
const authorization = createAuthorizationService({ database });
let now = new Date("2037-04-10T15:00:00.000Z");
let workspaceId: string;
let manager: AuthenticatedContext;
let closer: AuthenticatedContext;
let system: ServiceActorContext;
let productId: string;
let pipelineId: string;
const stages = new Map<string, string>();
let phoneSequence = 70_000_000;

async function human(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

function opportunityService() { return createOpportunityService({ database, authorization, now: () => now }); }
function gateService() { return createSalesGateService({ database, authorization, now: () => now }); }
function futureLocal(days: number) {
  const date = new Date(now.getTime() + days * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

async function scenario(label: string) {
  phoneSequence += 1;
  const intake = await createLeadIntakeService({ database, authorization, now: () => now }).intake({ channel: "MANUAL", idempotencyKey: `stage05:${label}:${randomUUID()}`, fullName: `Mandato ${label}`, phone: `+55119${phoneSequence.toString().slice(-8)}`, interestSummary: "Venda consultiva de mandato", sourceKey: "manual", priorityBandCode: "P1", rawPayload: { test: "stage05" } }, system);
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  const meeting = await database.meeting.create({ data: { workspaceId, leadId: intake.leadId, ownerMemberId: closer.memberId, title: "Diagnóstico consultivo", status: "COMPLETED", startsAt: new Date(now.getTime() - 3_600_000), endsAt: new Date(now.getTime() - 1_800_000), durationMinutes: 30, timeZone: "America/Sao_Paulo", completedAt: now, outcome: "Diagnóstico realizado", createdByActorId: manager.actorId, updatedByActorId: manager.actorId } });
  const created = await opportunityService().create(manager, { leadId: intake.leadId, meetingId: meeting.id, ownerMemberId: closer.memberId, productId, name: `Mandato ${label}`, amountCents: "500000", mrrCents: "0", tcvCents: "500000", probabilityPercent: 50, nextAction: { title: "Próximo compromisso", dueAtLocal: futureLocal(5) } });
  return { leadId: intake.leadId, opportunityId: created.opportunityId };
}

async function validatePacto(leadId: string) {
  const qualification = await database.leadQualification.create({ data: { workspaceId, leadId, status: "COMPLETED", revision: 1, minimumRequiredDimensions: 5, validatedAt: now, validatedByActorId: manager.actorId, assessedAt: now, createdByActorId: manager.actorId, updatedByActorId: manager.actorId } });
  return database.pactoRevision.create({ data: { workspaceId, qualificationId: qualification.id, leadId, revisionNumber: 1, kind: "VALIDATED", qualificationStatus: "COMPLETED", minimumRequiredDimensions: 5, investigatedDimensions: 5, hasDisqualifyingDimension: false, isQualificationReady: true, createdByActorId: manager.actorId, createdAt: now } });
}

async function saveEvidence(opportunityId: string, revision: number, type: "DIAGNOSIS" | "ECONOMIC_BUYER" | "SPONSOR" | "USE_CASE" | "PILOT_CRITERIA" | "PROPOSAL_SCOPE" | "DECISION") {
  return gateService().command(manager, opportunityId, { action: "SAVE_EVIDENCE", type, summary: type === "PILOT_CRITERIA" ? "Piloto não aplicável; escopo institucional aprovado diretamente." : `Evidência humana ${type}`, stakeholderName: type === "ECONOMIC_BUYER" ? "Decisor responsável" : null, expectedRevision: revision, idempotencyKey: `stage05:${opportunityId}:${type}` });
}

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database);
  workspaceId = seeded.workspaceId;
  const systemActor = await database.actor.findFirstOrThrow({ where: { workspaceId, key: "system" } });
  system = { workspaceId, actorId: systemActor.id, actorKey: "system", actorType: "SYSTEM" };
  [manager, closer] = await Promise.all([human("gestor@demo.politizai.local"), human("closer1@demo.politizai.local")]);
  const product = await database.product.create({ data: { workspaceId, sku: "MANDATO-STAGE05", name: "Mandato consultivo", salesGateProfile: "MANDATO", listPriceCents: 500000n, createdByActorId: systemActor.id, updatedByActorId: systemActor.id } });
  productId = product.id;
  const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "OPPORTUNITY", isDefault: true }, include: { stages: { where: { deletedAt: null }, orderBy: { position: "asc" } } } });
  pipelineId = pipeline.id;
  pipeline.stages.forEach((stage) => stages.set(stage.opportunityStageCode ?? "", stage.id));
  const template = await database.pipelineTemplate.create({ data: { workspaceId, key: `stage05-${randomUUID().slice(0, 8)}`, name: "Atividades consultivas", entityType: "OPPORTUNITY", createdByActorId: manager.actorId } });
  const version = await database.pipelineTemplateVersion.create({ data: { workspaceId, templateId: template.id, version: 1, name: template.name, changeReason: "Teste de reentrada", createdByActorId: manager.actorId } });
  for (const stage of pipeline.stages) {
    const definitionStage = await database.pipelineTemplateStage.create({ data: { workspaceId, templateVersionId: version.id, stableKey: stage.opportunityStageCode!.toLowerCase(), name: stage.name, position: stage.position, type: stage.type, opportunityStageCode: stage.opportunityStageCode } });
    if (["OPPORTUNITY_CONFIRMED", "NEGOTIATION"].includes(stage.opportunityStageCode ?? "")) await database.pipelineTemplateActivityDefinition.create({ data: { workspaceId, templateVersionId: version.id, stageId: definitionStage.id, activityType: "FOLLOW_UP", title: `Atividade ${stage.name}`, script: "Roteiro consultivo", dueOffsetDays: 2, position: 0, required: false, reentryPolicy: "RECREATE_ON_REENTRY" } });
  }
  await database.pipelineTemplateApplication.upsert({ where: { pipelineId }, create: { workspaceId, pipelineId, templateVersionId: version.id, editMode: "LOCAL_COPY", appliedByActorId: manager.actorId }, update: { templateVersionId: version.id, editMode: "LOCAL_COPY", appliedByActorId: manager.actorId } });
});

afterAll(async () => database.$disconnect());

describe("gates consultivos e atividades de etapa", () => {
  it("bloqueia proposta sem PACTO/evidência, recalcula atividade na reentrada e não cria pagamento ao ganhar", async () => {
    const created = await scenario("fluxo");
    await expect(opportunityService().transition(manager, { action: "TRANSITION", opportunityId: created.opportunityId, targetStageId: stages.get("OPPORTUNITY_CONFIRMED"), expectedRevision: 1, reason: "Confirmar oportunidade", origin: "OPPORTUNITY_CARD", confirmed: false, lossReasonId: null })).rejects.toMatchObject({ code: "PACTO_HUMAN_VALIDATION_REQUIRED" });
    await validatePacto(created.leadId);
    let revision = 1;
    for (const type of ["DIAGNOSIS", "USE_CASE"] as const) revision = (await saveEvidence(created.opportunityId, revision, type) as { revision: number }).revision;
    revision = (await opportunityService().transition(manager, { action: "TRANSITION", opportunityId: created.opportunityId, targetStageId: stages.get("OPPORTUNITY_CONFIRMED"), expectedRevision: revision, reason: "Evidência confirmada", origin: "OPPORTUNITY_CARD", confirmed: false, lossReasonId: null }) as { revision: number }).revision;
    const firstActivity = await database.opportunityStageActivityInstance.findFirstOrThrow({ where: { workspaceId, opportunityId: created.opportunityId, status: "ACTIVE" } });
    expect(Math.abs(firstActivity.dueAt.getTime() - (now.getTime() + 2 * 86_400_000))).toBeLessThanOrEqual(1);
    await expect(opportunityService().registerProposal(manager, { action: "PROPOSAL", opportunityId: created.opportunityId, expectedRevision: revision, productId, offerTemplateId: null, name: "Proposta mandato", quantity: 1, unitPriceCents: "500000", discountCents: "0", confirmed: true })).rejects.toMatchObject({ code: "CONSULTATIVE_EVIDENCE_REQUIRED" });
    for (const type of ["ECONOMIC_BUYER", "PILOT_CRITERIA", "PROPOSAL_SCOPE"] as const) revision = (await saveEvidence(created.opportunityId, revision, type) as { revision: number }).revision;
    const proposal = await opportunityService().registerProposal(manager, { action: "PROPOSAL", opportunityId: created.opportunityId, expectedRevision: revision, productId, offerTemplateId: null, name: "Proposta mandato", quantity: 1, unitPriceCents: "500000", discountCents: "0", confirmed: true }) as { revision: number };
    revision = proposal.revision;
    revision = (await saveEvidence(created.opportunityId, revision, "DECISION") as { revision: number }).revision;
    revision = (await opportunityService().transition(manager, { action: "TRANSITION", opportunityId: created.opportunityId, targetStageId: stages.get("NEGOTIATION"), expectedRevision: revision, reason: "Negociar", origin: "OPPORTUNITY_CARD", confirmed: false, lossReasonId: null }) as { revision: number }).revision;
    const standalone = await database.task.findFirstOrThrow({ where: { workspaceId, opportunityId: created.opportunityId, title: "Próximo compromisso" } });
    expect(standalone.status).toBe("OPEN");
    const paymentCount = await database.payment.count({ where: { workspaceId } });
    revision = (await opportunityService().transition(manager, { action: "TRANSITION", opportunityId: created.opportunityId, targetStageId: stages.get("WON"), expectedRevision: revision, reason: "Contrato ganho, pagamento separado", origin: "OPPORTUNITY_CARD", confirmed: true, lossReasonId: null }) as { revision: number }).revision;
    expect(await database.payment.count({ where: { workspaceId } })).toBe(paymentCount);
    now = new Date(now.getTime() + 5 * 86_400_000);
    await opportunityService().reopen(manager, { action: "REOPEN", opportunityId: created.opportunityId, expectedRevision: revision, reason: "Reabrir negociação", confirmed: true, nextAction: { title: "Retomar negociação", dueAtLocal: futureLocal(2) } });
    const negotiationActivities = await database.opportunityStageActivityInstance.findMany({ where: { workspaceId, opportunityId: created.opportunityId, definition: { stage: { opportunityStageCode: "NEGOTIATION" } } }, orderBy: { entrySequence: "asc" } });
    expect(negotiationActivities).toHaveLength(2);
    expect(negotiationActivities[1]!.dueAt.getTime()).toBeGreaterThan(negotiationActivities[0]!.dueAt.getTime());
    const snapshots = await database.opportunityGateEvaluation.findMany({ where: { workspaceId, opportunityId: created.opportunityId } });
    expect(snapshots.some((item) => item.targetStageCode === "PROPOSAL" && Array.isArray(item.evidenceSnapshot))).toBe(true);
  });

  it("preserva ACK na nova varredura e resolve revisão quando a condição desaparece, sem mover etapa", async () => {
    const created = await scenario("reviews");
    const before = await database.opportunity.findUniqueOrThrow({ where: { id: created.opportunityId } });
    const deferred = await gateService().command(manager, created.opportunityId, { action: "DEFER", reason: "Cliente pediu revisão após deliberação interna.", reviewAt: new Date(now.getTime() + 10 * 86_400_000).toISOString(), expectedRevision: before.revision }) as { revision: number };
    const deferral = await database.opportunityDeferral.findFirstOrThrow({ where: { workspaceId, opportunityId: created.opportunityId }, include: { task: true } });
    expect(deferral.task.status).toBe("OPEN");
    await gateService().scanReviews(manager, { action: "SCAN", staleHours: 72, maxStageDays: 30 });
    let review = await database.processViolation.findFirstOrThrow({ where: { workspaceId, opportunityId: created.opportunityId, type: "OPPORTUNITY_DECISION_MAKER_UNCERTAIN" } });
    await gateService().scanReviews(manager, { action: "ACKNOWLEDGE_REVIEW", reviewId: review.id, reason: "Gestor assumiu a revisão." });
    await gateService().scanReviews(manager, { action: "SCAN", staleHours: 72, maxStageDays: 30 });
    review = await database.processViolation.findUniqueOrThrow({ where: { id: review.id } });
    expect(review.status).toBe("ACKNOWLEDGED");
    await saveEvidence(created.opportunityId, deferred.revision, "ECONOMIC_BUYER");
    await gateService().scanReviews(manager, { action: "SCAN", staleHours: 72, maxStageDays: 30 });
    review = await database.processViolation.findUniqueOrThrow({ where: { id: review.id } });
    expect(review.status).toBe("RESOLVED");
    const after = await database.opportunity.findUniqueOrThrow({ where: { id: created.opportunityId } });
    expect(after.currentStageId).toBe(before.currentStageId);
  });
});
