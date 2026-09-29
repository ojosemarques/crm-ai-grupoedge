import type { OwnershipFunction, Prisma, RevenueLifecycleStage } from "@/generated/prisma/client";
import { LIFECYCLE_RULE_KEY, LIFECYCLE_RULE_VERSION } from "@/modules/lifecycle/domain/lifecycle-policy";

type Transaction = Prisma.TransactionClient;

async function ensureContactLifecycle(
  tx: Transaction,
  input: Readonly<{
    workspaceId: string;
    contactId: string;
    stage: RevenueLifecycleStage;
    actorId: string;
    occurredAt: Date;
    source: "LEAD_EVENT" | "OPPORTUNITY_EVENT";
    sourceEntityType: "Lead" | "Opportunity";
    sourceEntityId: string;
    idempotencyKey: string;
    reason: string;
  }>,
) {
  const duplicate = await tx.lifecycleHistory.findUnique({
    where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey } },
    select: { id: true },
  });
  if (duplicate) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lifecycle:${input.workspaceId}:CONTACT:${input.contactId}`}, 0))`;
  const current = await tx.revenueLifecycle.findFirst({ where: { workspaceId: input.workspaceId, contactId: input.contactId } });
  if (current?.stage === input.stage) return;
  if (current?.lastHistoryId) {
    await tx.lifecycleHistory.update({ where: { id: current.lastHistoryId }, data: { exitedAt: input.occurredAt } });
  }
  const history = await tx.lifecycleHistory.create({ data: {
    workspaceId: input.workspaceId,
    entityType: "CONTACT",
    contactId: input.contactId,
    fromStage: current?.stage ?? "UNKNOWN",
    toStage: input.stage,
    enteredAt: input.occurredAt,
    reason: input.reason,
    source: input.source,
    sourceEntityType: input.sourceEntityType,
    sourceEntityId: input.sourceEntityId,
    ruleKey: LIFECYCLE_RULE_KEY,
    ruleVersion: LIFECYCLE_RULE_VERSION,
    idempotencyKey: input.idempotencyKey,
    createdByActorId: input.actorId,
  } });
  if (current) {
    await tx.revenueLifecycle.update({ where: { id: current.id }, data: { stage: input.stage, currentSince: input.occurredAt, source: input.source, sourceEntityType: input.sourceEntityType, sourceEntityId: input.sourceEntityId, evidenceQuality: "CONFIRMED", lastHistoryId: history.id, revision: { increment: 1 }, updatedByActorId: input.actorId } });
  } else {
    await tx.revenueLifecycle.create({ data: { workspaceId: input.workspaceId, entityType: "CONTACT", contactId: input.contactId, stage: input.stage, currentSince: input.occurredAt, source: input.source, sourceEntityType: input.sourceEntityType, sourceEntityId: input.sourceEntityId, ruleKey: LIFECYCLE_RULE_KEY, ruleVersion: LIFECYCLE_RULE_VERSION, evidenceQuality: "CONFIRMED", lastHistoryId: history.id, createdByActorId: input.actorId, updatedByActorId: input.actorId } });
  }
}

async function ensureAssignment(
  tx: Transaction,
  input: Readonly<{
    workspaceId: string;
    entityType: "CONTACT" | "LEAD" | "OPPORTUNITY";
    entityId: string;
    function: OwnershipFunction;
    memberId: string | null;
    queueId: string | null;
    actorId: string;
    occurredAt: Date;
    idempotencyKey: string;
    source: "LEAD_ASSIGNMENT" | "OPPORTUNITY_ASSIGNMENT";
    sourceEntityType: "LeadAssignment" | "Opportunity";
    sourceEntityId: string;
    reason: string;
  }>,
) {
  const duplicate = await tx.ownershipAssignment.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey } } });
  if (duplicate) return;
  const where = input.entityType === "CONTACT" ? { contactId: input.entityId } : input.entityType === "LEAD" ? { leadId: input.entityId } : { opportunityId: input.entityId };
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ownership:${input.workspaceId}:${input.entityType}:${input.entityId}:${input.function}`}, 0))`;
  const current = await tx.ownershipAssignment.findFirst({ where: { workspaceId: input.workspaceId, ...where, function: input.function, status: "ACTIVE" } });
  if (current?.memberId === input.memberId && current.queueId === input.queueId) return;
  if (current) await tx.ownershipAssignment.update({ where: { id: current.id }, data: { status: "ENDED", validTo: input.occurredAt, endedByActorId: input.actorId } });
  await tx.ownershipAssignment.create({ data: {
    workspaceId: input.workspaceId,
    entityType: input.entityType,
    contactId: input.entityType === "CONTACT" ? input.entityId : null,
    leadId: input.entityType === "LEAD" ? input.entityId : null,
    opportunityId: input.entityType === "OPPORTUNITY" ? input.entityId : null,
    function: input.function,
    memberId: input.memberId,
    queueId: input.queueId,
    validFrom: input.occurredAt,
    reason: input.reason,
    source: input.source,
    sourceEntityType: input.sourceEntityType,
    sourceEntityId: input.sourceEntityId,
    idempotencyKey: input.idempotencyKey,
    assignedByActorId: input.actorId,
  } });
}

export async function projectLeadOwnership(
  tx: Transaction,
  input: Readonly<{ workspaceId: string; leadId: string; memberId: string | null; queueId: string | null; actorId: string; occurredAt: Date; sourceEntityId: string }>,
) {
  const lead = await tx.lead.findFirst({ where: { id: input.leadId, workspaceId: input.workspaceId }, select: { contactId: true } });
  if (!lead) return;
  await ensureAssignment(tx, { ...input, entityType: "LEAD", entityId: input.leadId, function: "SDR", idempotencyKey: `lead-owner:${input.sourceEntityId}`, source: "LEAD_ASSIGNMENT", sourceEntityType: "LeadAssignment", reason: "Projeção da responsabilidade operacional do lead." });
  if (!lead.contactId) return;
  await ensureAssignment(tx, { ...input, entityType: "CONTACT", entityId: lead.contactId, function: "SDR", idempotencyKey: `contact-sdr:${input.sourceEntityId}`, source: "LEAD_ASSIGNMENT", sourceEntityType: "LeadAssignment", reason: "Projeção da responsabilidade SDR a partir do lead." });
  await ensureContactLifecycle(tx, { workspaceId: input.workspaceId, contactId: lead.contactId, stage: "LEAD", actorId: input.actorId, occurredAt: input.occurredAt, source: "LEAD_EVENT", sourceEntityType: "Lead", sourceEntityId: input.leadId, idempotencyKey: `contact-lifecycle-lead:${input.leadId}`, reason: "Contato entrou no ciclo como lead persistido." });
}

export async function projectOpportunityOwnership(
  tx: Transaction,
  input: Readonly<{ workspaceId: string; opportunityId: string; leadId: string; memberId: string; actorId: string; occurredAt: Date }>,
) {
  const lead = await tx.lead.findFirst({ where: { id: input.leadId, workspaceId: input.workspaceId }, select: { contactId: true } });
  await ensureAssignment(tx, { workspaceId: input.workspaceId, entityType: "OPPORTUNITY", entityId: input.opportunityId, function: "CLOSER", memberId: input.memberId, queueId: null, actorId: input.actorId, occurredAt: input.occurredAt, idempotencyKey: `opportunity-owner:${input.opportunityId}`, source: "OPPORTUNITY_ASSIGNMENT", sourceEntityType: "Opportunity", sourceEntityId: input.opportunityId, reason: "Closer responsável na criação da oportunidade." });
  if (!lead?.contactId) return;
  await ensureAssignment(tx, { workspaceId: input.workspaceId, entityType: "CONTACT", entityId: lead.contactId, function: "CLOSER", memberId: input.memberId, queueId: null, actorId: input.actorId, occurredAt: input.occurredAt, idempotencyKey: `contact-closer:${input.opportunityId}`, source: "OPPORTUNITY_ASSIGNMENT", sourceEntityType: "Opportunity", sourceEntityId: input.opportunityId, reason: "Responsabilidade closer derivada de oportunidade explícita." });
  await ensureContactLifecycle(tx, { workspaceId: input.workspaceId, contactId: lead.contactId, stage: "OPPORTUNITY", actorId: input.actorId, occurredAt: input.occurredAt, source: "OPPORTUNITY_EVENT", sourceEntityType: "Opportunity", sourceEntityId: input.opportunityId, idempotencyKey: `contact-lifecycle-opportunity:${input.opportunityId}`, reason: "Oportunidade comercial criada para o contato." });
}
