import type { OpportunityPipelineStageCode, PermissionScope, Prisma, PrismaClient, TaskKind } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { consultativeEvidenceTypes, evidenceLabels, salesGateCommandSchema, salesReviewCommandSchema, type ConsultativeEvidenceType } from "@/modules/opportunities/domain/sales-gate-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type AuthorizationPort = Pick<ReturnType<typeof getAuthorizationService>, "authorize" | "assertAuthorized">;
type SalesGateOptions = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>;

const requiredByStage: Readonly<Partial<Record<OpportunityPipelineStageCode, readonly ConsultativeEvidenceType[]>>> = Object.freeze({
  OPPORTUNITY_CONFIRMED: ["DIAGNOSIS", "USE_CASE"],
  PROPOSAL: ["DIAGNOSIS", "USE_CASE", "PILOT_CRITERIA", "PROPOSAL_SCOPE"],
  NEGOTIATION: ["DIAGNOSIS", "USE_CASE", "PILOT_CRITERIA", "PROPOSAL_SCOPE", "DECISION"],
  WON: ["DIAGNOSIS", "USE_CASE", "PILOT_CRITERIA", "PROPOSAL_SCOPE", "DECISION"],
});

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }

function taskKind(activityType: string): TaskKind {
  const normalized = activityType.trim().toUpperCase();
  return (["GENERAL", "IMMEDIATE_CALL", "CALL", "MESSAGE", "INSTAGRAM_MESSAGE", "INSTAGRAM_FOLLOW", "EMAIL", "MEETING", "FOLLOW_UP"] as const).includes(normalized as TaskKind)
    ? normalized as TaskKind
    : "GENERAL";
}

type ActivityPermissionDecision = Readonly<
  | { allowed: true; scope: PermissionScope }
  | { allowed: false }
>;

function activityPermission(
  task: Readonly<{ context: string; meetingId: string | null; opportunityId: string | null }>,
  decisions: Readonly<{
    tasks: ActivityPermissionDecision;
    opportunities: ActivityPermissionDecision;
    meetings: ActivityPermissionDecision;
    postSale: ActivityPermissionDecision;
  }>,
) {
  if (task.context === "POST_SALE") return decisions.postSale;
  if (task.meetingId) return decisions.meetings;
  if (task.opportunityId) return decisions.opportunities;
  return decisions.tasks;
}

function withinActivityScope(
  decision: ActivityPermissionDecision,
  context: AuthenticatedContext,
  teamMemberIds: ReadonlySet<string>,
  teamIds: ReadonlySet<string>,
  ownerMemberId: string | null,
  queueTeamId: string | null,
) {
  if (!decision.allowed) return false;
  if (decision.scope === "WORKSPACE") return true;
  if (ownerMemberId === context.memberId) return true;
  if (decision.scope === "OWN") return false;
  return Boolean(
    (ownerMemberId && teamMemberIds.has(ownerMemberId)) ||
      (queueTeamId && teamIds.has(queueTeamId)),
  );
}

function automationCategory(value: Prisma.JsonValue | null): string | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const category = value.category;
  return typeof category === "string" ? category : null;
}

async function opportunityForAccess(database: PrismaClient, context: AuthenticatedContext, opportunityId: string) {
  const row = await database.opportunity.findFirst({
    where: { id: opportunityId, workspaceId: context.workspaceId, deletedAt: null },
    select: { id: true, ownerMemberId: true, lead: { select: { sourceId: true, routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } } },
  });
  if (!row) fail("Oportunidade não encontrada.", "NOT_FOUND", 404);
  return row;
}

async function authorizeOpportunity(options: SalesGateOptions, context: AuthenticatedContext, opportunityId: string, write: boolean) {
  const row = await opportunityForAccess(options.database, context, opportunityId);
  const permission = write ? PermissionKeys.OPPORTUNITIES_WRITE : PermissionKeys.OPPORTUNITIES_READ;
  const resource = {
    workspaceId: context.workspaceId,
    resourceType: "Opportunity",
    resourceId: row.id,
    ownerMemberId: row.ownerMemberId,
    teamId: row.lead.routingQueue?.teamId ?? row.lead.queue?.teamId ?? null,
  };
  const decision = await options.authorization.authorize(context, permission, resource);
  if (!decision.allowed) await options.authorization.assertAuthorized(context, permission, resource);
  const scope = decision.allowed ? decision.scope : fail("Acesso negado.", "ACCESS_DENIED", 403);
  if (scope !== "WORKSPACE") {
    const memberships = await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } });
    const rules = await options.database.pipelineOriginAccessRule.findMany({ where: { workspaceId: context.workspaceId, sourceId: row.lead.sourceId }, select: { teamId: true, canRead: true, canTransition: true } });
    if (rules.length > 0 && !rules.some((rule) => memberships.some((membership) => membership.teamId === rule.teamId) && (write ? rule.canTransition : rule.canRead))) fail("A origem não permite esta ação para a equipe do vendedor.", "ORIGIN_TEAM_DENIED", 403);
  }
  return row;
}

export type GateSnapshot = Readonly<{
  profile: "STANDARD" | "MANDATO";
  pactoRevisionId: string | null;
  evidence: readonly Readonly<{ id: string; type: ConsultativeEvidenceType; version: number }>[];
}>;

export async function assertConsultativeSalesGates(
  transaction: Prisma.TransactionClient,
  opportunityId: string,
  targetStageCode: OpportunityPipelineStageCode,
  targetProductId?: string | null,
): Promise<GateSnapshot> {
  const opportunity = await transaction.opportunity.findFirst({
    where: { id: opportunityId },
    include: { product: { select: { salesGateProfile: true } } },
  });
  if (!opportunity) fail("Oportunidade não encontrada.", "NOT_FOUND", 404);
  const targetProduct = targetProductId && targetProductId !== opportunity.productId
    ? await transaction.product.findFirst({ where: { id: targetProductId, workspaceId: opportunity.workspaceId }, select: { salesGateProfile: true } })
    : opportunity.product;
  const profile = targetProduct?.salesGateProfile ?? "STANDARD";
  if (profile === "STANDARD" || !requiredByStage[targetStageCode]) return { profile, pactoRevisionId: null, evidence: [] };

  const pacto = await transaction.pactoRevision.findFirst({
    where: { workspaceId: opportunity.workspaceId, leadId: opportunity.leadId, kind: "VALIDATED", isQualificationReady: true },
    orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!pacto) fail("O avanço de Mandato exige PACTO validado por uma pessoa.", "PACTO_HUMAN_VALIDATION_REQUIRED");
  const evidence = await transaction.opportunityEvidence.findMany({
    where: { workspaceId: opportunity.workspaceId, opportunityId, supersededAt: null },
    select: { id: true, type: true, version: true },
  });
  const present = new Set(evidence.map((item) => item.type));
  const missing = (requiredByStage[targetStageCode] ?? []).filter((type) => !present.has(type));
  if (targetStageCode === "PROPOSAL" || targetStageCode === "NEGOTIATION" || targetStageCode === "WON") {
    if (!present.has("ECONOMIC_BUYER") && !present.has("SPONSOR")) missing.push("ECONOMIC_BUYER");
  }
  if (missing.length > 0) fail(`Anexe evidências antes de avançar: ${[...new Set(missing)].map((type) => evidenceLabels[type]).join(", ")}.`, "CONSULTATIVE_EVIDENCE_REQUIRED");
  return { profile, pactoRevisionId: pacto.id, evidence };
}

export async function recordGateEvaluation(
  transaction: Prisma.TransactionClient,
  input: Readonly<{ workspaceId: string; opportunityId: string; stageHistoryId: string; targetStageCode: OpportunityPipelineStageCode; actorId: string; evaluatedAt: Date; snapshot: GateSnapshot }>,
) {
  return transaction.opportunityGateEvaluation.create({
    data: {
      workspaceId: input.workspaceId,
      opportunityId: input.opportunityId,
      stageHistoryId: input.stageHistoryId,
      pactoRevisionId: input.snapshot.pactoRevisionId,
      salesGateProfile: input.snapshot.profile,
      targetStageCode: input.targetStageCode,
      evidenceSnapshot: json(input.snapshot.evidence),
      evaluatedByActorId: input.actorId,
      evaluatedAt: input.evaluatedAt,
    },
  });
}

export async function assertRequiredStageActivitiesComplete(transaction: Prisma.TransactionClient, workspaceId: string, opportunityId: string) {
  const pending = await transaction.opportunityStageActivityInstance.findMany({
    where: { workspaceId, opportunityId, status: "ACTIVE", definition: { required: true } },
    select: { title: true },
  });
  if (pending.length) fail(`Conclua as atividades obrigatórias da etapa: ${pending.map((item) => item.title).join(", ")}.`, "REQUIRED_STAGE_ACTIVITY_PENDING");
}

export async function supersedeOpenStageActivities(transaction: Prisma.TransactionClient, workspaceId: string, opportunityId: string, actorId: string, at: Date) {
  const instances = await transaction.opportunityStageActivityInstance.findMany({ where: { workspaceId, opportunityId, status: "ACTIVE" }, select: { id: true, taskId: true } });
  if (instances.length === 0) return;
  await transaction.task.updateMany({
    where: { workspaceId, id: { in: instances.map((item) => item.taskId) }, status: { in: ["OPEN", "IN_PROGRESS"] } },
    data: { status: "CANCELLED", result: "Atividade de etapa encerrada por mudança de etapa.", updatedByActorId: actorId, updatedAt: at },
  });
  await transaction.opportunityStageActivityInstance.updateMany({
    where: { workspaceId, id: { in: instances.map((item) => item.id) } },
    data: { status: "SUPERSEDED", supersededAt: at },
  });
}

export async function instantiateStageActivities(
  transaction: Prisma.TransactionClient,
  input: Readonly<{ workspaceId: string; opportunityId: string; leadId: string; ownerMemberId: string; pipelineId: string; stageId: string; stageHistoryId: string; actorId: string; enteredAt: Date }>,
) {
  const pipeline = await transaction.pipeline.findFirst({
    where: { id: input.pipelineId, workspaceId: input.workspaceId },
    include: { templateApplication: { include: { templateVersion: { include: { stages: { include: { activities: { orderBy: { position: "asc" } } } } } } } }, stages: { where: { id: input.stageId }, select: { position: true } } },
  });
  const position = pipeline?.stages[0]?.position;
  const templateStage = position === undefined ? null : pipeline?.templateApplication?.templateVersion.stages.find((stage) => stage.position === position);
  if (!templateStage) return [];
  const created: string[] = [];
  for (const definition of templateStage.activities) {
    if (definition.reentryPolicy === "ONCE_PER_OPPORTUNITY") {
      const previous = await transaction.opportunityStageActivityInstance.findFirst({ where: { workspaceId: input.workspaceId, opportunityId: input.opportunityId, definitionId: definition.id }, select: { id: true } });
      if (previous) continue;
    }
    const entrySequence = await transaction.opportunityStageActivityInstance.count({ where: { workspaceId: input.workspaceId, opportunityId: input.opportunityId, definitionId: definition.id } }) + 1;
    const dueAt = new Date(input.enteredAt.getTime() + definition.dueOffsetDays * 86_400_000);
    const task = await transaction.task.create({ data: {
      workspaceId: input.workspaceId, leadId: input.leadId, opportunityId: input.opportunityId,
      assigneeMemberId: input.ownerMemberId, title: definition.title, description: definition.script,
      kind: taskKind(definition.activityType), status: "OPEN", priority: definition.required ? "HIGH" : "MEDIUM",
      dueAt, createdByActorId: input.actorId, updatedByActorId: input.actorId, createdAt: input.enteredAt, updatedAt: input.enteredAt,
    } });
    const instance = await transaction.opportunityStageActivityInstance.create({ data: {
      workspaceId: input.workspaceId, opportunityId: input.opportunityId, stageHistoryId: input.stageHistoryId,
      definitionId: definition.id, taskId: task.id, entrySequence, title: definition.title, script: definition.script,
      activityType: definition.activityType, dueAt, reentryPolicy: definition.reentryPolicy,
    } });
    created.push(instance.id);
  }
  return created;
}

export function createSalesGateService(options: SalesGateOptions) {
  async function getScreen(context: AuthenticatedContext, opportunityId: string) {
    await authorizeOpportunity(options, context, opportunityId, false);
    const opportunity = await options.database.opportunity.findFirstOrThrow({
      where: { id: opportunityId, workspaceId: context.workspaceId },
      include: {
        product: { select: { salesGateProfile: true } },
        currentStage: { select: { opportunityStageCode: true } },
        consultativeEvidence: { where: { supersededAt: null }, orderBy: [{ type: "asc" }, { version: "desc" }] },
        stageActivities: { include: { task: { select: { status: true } } }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }] },
        processViolations: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, type: { in: ["OPPORTUNITY_STAGNANT", "OPPORTUNITY_STAGE_OVERDUE", "OPPORTUNITY_VALUE_UNCERTAIN", "OPPORTUNITY_DECISION_MAKER_UNCERTAIN"] } }, orderBy: { lastDetectedAt: "desc" } },
      },
    });
    const pacto = await options.database.pactoRevision.findFirst({ where: { workspaceId: context.workspaceId, leadId: opportunity.leadId, kind: "VALIDATED", isQualificationReady: true }, orderBy: { revisionNumber: "desc" }, select: { id: true, revisionNumber: true, createdAt: true } });
    const present = new Set(opportunity.consultativeEvidence.map((item) => item.type));
    return {
      opportunityId, revision: opportunity.revision, salesGateProfile: opportunity.product?.salesGateProfile ?? "STANDARD",
      pacto: { validated: Boolean(pacto), revisionId: pacto?.id ?? null, revisionNumber: pacto?.revisionNumber ?? null, validatedAt: pacto?.createdAt.toISOString() ?? null },
      evidence: opportunity.consultativeEvidence.map((item) => ({ id: item.id, type: item.type, summary: item.summary, stakeholderName: item.stakeholderName, sourceUrl: item.sourceUrl, version: item.version, confirmedAt: item.confirmedAt.toISOString() })),
      requiredEvidence: consultativeEvidenceTypes.map((type) => ({ type, label: evidenceLabels[type], present: present.has(type), requiredForStages: Object.entries(requiredByStage).filter(([, values]) => values?.includes(type)).map(([stage]) => stage) })),
      stageActivities: opportunity.stageActivities.map((item) => ({ id: item.id, title: item.title, script: item.script, activityType: item.activityType, dueAt: item.dueAt.toISOString(), status: item.status, taskStatus: item.task.status, taskId: item.taskId, reentryPolicy: item.reentryPolicy, completedAt: item.completedAt?.toISOString() ?? null })),
      reviews: opportunity.processViolations.map((item) => ({ id: item.id, type: item.type, severity: item.severity, status: item.status, title: item.title, evidenceSummary: item.evidenceSummary, detectedAt: item.detectedAt.toISOString(), lastDetectedAt: item.lastDetectedAt.toISOString() })),
      currentStageCode: opportunity.currentStage.opportunityStageCode,
    };
  }

  async function command(context: AuthenticatedContext, opportunityId: string, raw: unknown) {
    const parsed = salesGateCommandSchema.safeParse(raw);
    if (!parsed.success) fail(parsed.error.issues.map((item) => item.message).join(" "), "INVALID_INPUT", 400);
    await authorizeOpportunity(options, context, opportunityId, true);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sales-gate:${context.workspaceId}:${opportunityId}`}, 0))`;
      const opportunity = await tx.opportunity.findFirst({ where: { id: opportunityId, workspaceId: context.workspaceId, deletedAt: null } });
      if (!opportunity) fail("Oportunidade não encontrada.", "NOT_FOUND", 404);
      if (opportunity.revision !== parsed.data.expectedRevision) fail("A oportunidade mudou. Recarregue antes de continuar.", "OPPORTUNITY_VERSION_CONFLICT");
      const at = options.now();
      if (parsed.data.action === "SAVE_EVIDENCE") {
        const replay = await tx.opportunityEvidence.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: parsed.data.idempotencyKey } } });
        if (replay) return { opportunityId, revision: opportunity.revision, evidenceId: replay.id, idempotent: true };
        const current = await tx.opportunityEvidence.findFirst({ where: { workspaceId: context.workspaceId, opportunityId, type: parsed.data.type, supersededAt: null }, orderBy: { version: "desc" } });
        if (current) await tx.opportunityEvidence.update({ where: { id: current.id }, data: { supersededAt: at, supersededByActorId: context.actorId } });
        const evidence = await tx.opportunityEvidence.create({ data: { workspaceId: context.workspaceId, opportunityId, type: parsed.data.type, version: (current?.version ?? 0) + 1, summary: parsed.data.summary, stakeholderName: parsed.data.stakeholderName ?? null, sourceUrl: parsed.data.sourceUrl ?? null, idempotencyKey: parsed.data.idempotencyKey, confirmedAt: at, recordedByActorId: context.actorId } });
        const updated = await tx.opportunity.update({ where: { id: opportunityId }, data: { revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: at } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "opportunity.evidence.recorded", entityType: "Opportunity", entityId: opportunityId, reason: parsed.data.summary, changes: { evidenceId: evidence.id, type: evidence.type, version: evidence.version, supersedesEvidenceId: current?.id ?? null } } });
        return { opportunityId, revision: updated.revision, evidenceId: evidence.id, idempotent: false };
      }
      if (parsed.data.action === "DEFER") {
        const reviewAt = new Date(parsed.data.reviewAt);
        if (reviewAt <= at) fail("A revisão do adiamento deve estar no futuro.", "INVALID_REVIEW_AT", 400);
        const task = await tx.task.create({ data: { workspaceId: context.workspaceId, leadId: opportunity.leadId, opportunityId, assigneeMemberId: opportunity.ownerMemberId, title: "Revisar oportunidade adiada", description: parsed.data.reason, kind: "FOLLOW_UP", status: "OPEN", priority: "HIGH", dueAt: reviewAt, createdByActorId: context.actorId, updatedByActorId: context.actorId, createdAt: at, updatedAt: at } });
        const deferral = await tx.opportunityDeferral.create({ data: { workspaceId: context.workspaceId, opportunityId, ownerMemberId: opportunity.ownerMemberId, reason: parsed.data.reason, reviewAt, taskId: task.id, createdByActorId: context.actorId, createdAt: at } });
        const updated = await tx.opportunity.update({ where: { id: opportunityId }, data: { nextActionTaskId: task.id, nextActionAt: reviewAt, nextActionDescription: task.title, revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: at } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "opportunity.deferred", entityType: "Opportunity", entityId: opportunityId, reason: parsed.data.reason, changes: { deferralId: deferral.id, reviewAt: reviewAt.toISOString(), taskId: task.id, status: opportunity.status } } });
        return { opportunityId, revision: updated.revision, deferralId: deferral.id, reviewAt: reviewAt.toISOString() };
      }
      const instance = await tx.opportunityStageActivityInstance.findFirst({ where: { id: parsed.data.instanceId, workspaceId: context.workspaceId, opportunityId }, include: { task: true } });
      if (!instance) fail("Atividade de etapa não encontrada.", "NOT_FOUND", 404);
      if (instance.status !== "ACTIVE") fail("A atividade de etapa não está ativa.", "STAGE_ACTIVITY_NOT_ACTIVE");
      await tx.task.update({ where: { id: instance.taskId }, data: { status: "COMPLETED", completedAt: at, result: parsed.data.result, updatedByActorId: context.actorId, updatedAt: at } });
      await tx.opportunityStageActivityInstance.update({ where: { id: instance.id }, data: { status: "COMPLETED", completedAt: at } });
      const updated = await tx.opportunity.update({ where: { id: opportunityId }, data: { revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: at } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "opportunity.stage_activity.completed", entityType: "Opportunity", entityId: opportunityId, reason: parsed.data.result, changes: { instanceId: instance.id, taskId: instance.taskId } } });
      return { opportunityId, revision: updated.revision, instanceId: instance.id };
    });
  }

  async function scanReviews(context: AuthenticatedContext, raw: unknown) {
    const parsed = salesReviewCommandSchema.safeParse(raw);
    if (!parsed.success) fail(parsed.error.issues.map((item) => item.message).join(" "), "INVALID_INPUT", 400);
    await options.authorization.assertAuthorized(context, PermissionKeys.AUDIT_MANAGE, { workspaceId: context.workspaceId, resourceType: "SalesReviewQueue", resourceId: context.workspaceId });
    if (parsed.data.action !== "SCAN") {
      const review = await options.database.processViolation.findFirst({ where: { id: parsed.data.reviewId, workspaceId: context.workspaceId, type: { in: ["OPPORTUNITY_STAGNANT", "OPPORTUNITY_STAGE_OVERDUE", "OPPORTUNITY_VALUE_UNCERTAIN", "OPPORTUNITY_DECISION_MAKER_UNCERTAIN"] } } });
      if (!review) fail("Revisão não encontrada.", "NOT_FOUND", 404);
      const at = options.now();
      return options.database.processViolation.update({ where: { id: review.id }, data: parsed.data.action === "ACKNOWLEDGE_REVIEW" ? { status: "ACKNOWLEDGED", acknowledgedAt: review.acknowledgedAt ?? at, acknowledgedByActorId: review.acknowledgedByActorId ?? context.actorId, resolutionReason: null } : { status: "RESOLVED", acknowledgedAt: review.acknowledgedAt ?? at, acknowledgedByActorId: review.acknowledgedByActorId ?? context.actorId, resolvedAt: at, resolvedByActorId: context.actorId, resolutionReason: parsed.data.reason } });
    }
    const now = options.now();
    const opportunities = await options.database.opportunity.findMany({ where: { workspaceId: context.workspaceId, status: "OPEN", deletedAt: null }, include: { product: { select: { salesGateProfile: true } }, stageHistory: { where: { exitedAt: null }, take: 1, orderBy: { enteredAt: "desc" } }, consultativeEvidence: { where: { supersededAt: null }, select: { type: true } }, accountPlan: { select: { waits: { where: { status: "PLANNED", reviewAt: { gt: now } }, take: 1, select: { id: true } } } } } });
    let detected = 0;
    for (const opportunity of opportunities) {
      const findings: Array<{ type: "OPPORTUNITY_STAGNANT" | "OPPORTUNITY_STAGE_OVERDUE" | "OPPORTUNITY_VALUE_UNCERTAIN" | "OPPORTUNITY_DECISION_MAKER_UNCERTAIN"; severity: "MEDIUM" | "HIGH"; title: string; summary: string; evidence: Prisma.InputJsonValue }> = [];
      const plannedWaitActive = Boolean(opportunity.accountPlan?.waits.length);
      if (!plannedWaitActive && (!opportunity.nextActionAt || opportunity.nextActionAt.getTime() < now.getTime() - parsed.data.staleHours * 3_600_000)) findings.push({ type: "OPPORTUNITY_STAGNANT", severity: "HIGH", title: "Negócio sem próximo compromisso válido", summary: "Próxima ação ausente ou vencida além do limite.", evidence: json({ nextActionAt: opportunity.nextActionAt?.toISOString() ?? null, staleHours: parsed.data.staleHours }) });
      const enteredAt = opportunity.stageHistory[0]?.enteredAt;
      if (!plannedWaitActive && enteredAt && enteredAt.getTime() < now.getTime() - parsed.data.maxStageDays * 86_400_000) findings.push({ type: "OPPORTUNITY_STAGE_OVERDUE", severity: "MEDIUM", title: "Tempo excessivo na etapa", summary: `Card permanece na etapa há mais de ${parsed.data.maxStageDays} dias.`, evidence: json({ enteredAt: enteredAt.toISOString(), maxStageDays: parsed.data.maxStageDays }) });
      if (opportunity.amountCents <= 0n || opportunity.tcvCents <= 0n) findings.push({ type: "OPPORTUNITY_VALUE_UNCERTAIN", severity: "MEDIUM", title: "Valor comercial incerto", summary: "Valor ou TCV não foi confirmado.", evidence: json({ amountCents: opportunity.amountCents.toString(), tcvCents: opportunity.tcvCents.toString() }) });
      const evidence = new Set(opportunity.consultativeEvidence.map((item) => item.type));
      if (opportunity.product?.salesGateProfile === "MANDATO" && !evidence.has("ECONOMIC_BUYER") && !evidence.has("SPONSOR")) findings.push({ type: "OPPORTUNITY_DECISION_MAKER_UNCERTAIN", severity: "HIGH", title: "Decisor ou patrocinador incerto", summary: "Mandato sem comprador econômico ou patrocinador confirmado.", evidence: json({ salesGateProfile: "MANDATO" }) });
      const activeTypes = new Set(findings.map((finding) => finding.type));
      const prior = await options.database.processViolation.findMany({ where: { workspaceId: context.workspaceId, opportunityId: opportunity.id, status: { in: ["OPEN", "ACKNOWLEDGED"] }, type: { in: ["OPPORTUNITY_STAGNANT", "OPPORTUNITY_STAGE_OVERDUE", "OPPORTUNITY_VALUE_UNCERTAIN", "OPPORTUNITY_DECISION_MAKER_UNCERTAIN"] } }, select: { id: true, type: true, acknowledgedAt: true, acknowledgedByActorId: true } });
      const cleared = prior.filter((item) => !activeTypes.has(item.type as typeof findings[number]["type"]));
      for (const item of cleared) await options.database.processViolation.update({ where: { id: item.id }, data: { status: "RESOLVED", acknowledgedAt: item.acknowledgedAt ?? now, acknowledgedByActorId: item.acknowledgedByActorId ?? context.actorId, resolvedAt: now, resolvedByActorId: context.actorId, resolutionReason: "Condição não detectada na revisão atual." } });
      for (const finding of findings) {
        const fingerprint = `stage05:${opportunity.id}:${finding.type}`;
        const existing = await options.database.processViolation.findUnique({ where: { workspaceId_fingerprint: { workspaceId: context.workspaceId, fingerprint } }, select: { status: true } });
        await options.database.processViolation.upsert({ where: { workspaceId_fingerprint: { workspaceId: context.workspaceId, fingerprint } }, create: { workspaceId: context.workspaceId, type: finding.type, severity: finding.severity, status: "OPEN", fingerprint, leadId: opportunity.leadId, opportunityId: opportunity.id, stageHistoryId: opportunity.stageHistory[0]?.id ?? null, title: finding.title, evidenceSummary: finding.summary, evidence: finding.evidence, detectedAt: now, lastDetectedAt: now, detectedByActorId: context.actorId }, update: { status: existing?.status === "RESOLVED" ? "OPEN" : existing?.status ?? "OPEN", severity: finding.severity, lastDetectedAt: now, ...(existing?.status === "RESOLVED" ? { resolvedAt: null, resolvedByActorId: null, resolutionReason: null, acknowledgedAt: null, acknowledgedByActorId: null } : {}) } });
        detected += 1;
      }
    }
    return { scanned: opportunities.length, detected, autoTransitions: 0 };
  }

  async function getReviews(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AUDIT_READ, { workspaceId: context.workspaceId, resourceType: "SalesReviewQueue", resourceId: context.workspaceId });
    const items = await options.database.processViolation.findMany({ where: { workspaceId: context.workspaceId, status: { in: ["OPEN", "ACKNOWLEDGED"] }, type: { in: ["OPPORTUNITY_STAGNANT", "OPPORTUNITY_STAGE_OVERDUE", "OPPORTUNITY_VALUE_UNCERTAIN", "OPPORTUNITY_DECISION_MAKER_UNCERTAIN"] } }, include: { opportunity: { select: { name: true, ownerMemberId: true, currentStage: { select: { name: true } } } } }, orderBy: [{ severity: "desc" }, { lastDetectedAt: "desc" }] });
    return { generatedAt: options.now().toISOString(), counts: { open: items.filter((item) => item.status === "OPEN").length, acknowledged: items.filter((item) => item.status === "ACKNOWLEDGED").length }, items: items.map((item) => ({ id: item.id, opportunityId: item.opportunityId, opportunityName: item.opportunity?.name ?? "Oportunidade", ownerMemberId: item.opportunity?.ownerMemberId ?? null, stageName: item.opportunity?.currentStage.name ?? null, type: item.type, severity: item.severity, status: item.status, title: item.title, evidenceSummary: item.evidenceSummary, detectedAt: item.detectedAt.toISOString(), lastDetectedAt: item.lastDetectedAt.toISOString() })) };
  }

  async function getActivityQueue(context: AuthenticatedContext) {
    const resource = { workspaceId: context.workspaceId, resourceType: "UnifiedActivityQueue", ownerMemberId: context.memberId };
    const [tasksDecision, opportunityDecision, meetingDecision, postSaleDecision] = await Promise.all([
      options.authorization.authorize(context, PermissionKeys.TASKS_READ, resource),
      options.authorization.authorize(context, PermissionKeys.OPPORTUNITIES_READ, resource),
      options.authorization.authorize(context, PermissionKeys.MEETINGS_READ, resource),
      options.authorization.authorize(context, PermissionKeys.CUSTOMER_SUCCESS_READ, resource),
    ]);
    const decisions = {
      tasks: tasksDecision,
      opportunities: opportunityDecision,
      meetings: meetingDecision,
      postSale: postSaleDecision,
    };
    if (!Object.values(decisions).some((decision) => decision.allowed)) {
      await options.authorization.assertAuthorized(context, PermissionKeys.TASKS_READ, resource);
    }

    const memberships = await options.database.teamMember.findMany({
      where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null },
      select: { teamId: true },
    });
    const teamIds = new Set(memberships.map((item) => item.teamId));
    const teamMembers = teamIds.size
      ? await options.database.teamMember.findMany({
          where: { workspaceId: context.workspaceId, teamId: { in: [...teamIds] }, deletedAt: null },
          select: { workspaceMemberId: true },
          distinct: ["workspaceMemberId"],
        })
      : [];
    const teamMemberIds = new Set(teamMembers.map((item) => item.workspaceMemberId));
    const [tasks, meetings, originRules] = await Promise.all([
      options.database.task.findMany({
        where: {
          workspaceId: context.workspaceId,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          deletedAt: null,
        },
        include: {
          lead: { select: { id: true, fullName: true, accountId: true, sourceId: true, currentStage: { select: { name: true } } } },
          opportunity: { select: { name: true, currentStage: { select: { name: true } } } },
          meeting: { select: { title: true, status: true } },
          stageActivityInstance: { select: { id: true, activityType: true, script: true, reentryPolicy: true } },
          automationRun: { select: { actionConfigSnapshot: true } },
          assignee: { select: { user: { select: { displayName: true } } } },
          queue: { select: { name: true, teamId: true } },
        },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
      meetingDecision.allowed
        ? options.database.meeting.findMany({
            where: {
              workspaceId: context.workspaceId,
              deletedAt: null,
              status: { in: ["SCHEDULED", "CONFIRMED"] },
              tasks: { none: { status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null } },
            },
            include: {
              lead: { select: { id: true, fullName: true, sourceId: true } },
              opportunity: { select: { name: true, currentStage: { select: { name: true } } } },
              owner: { select: { user: { select: { displayName: true } } } },
            },
            orderBy: [{ startsAt: "asc" }, { id: "asc" }],
          })
        : Promise.resolve([]),
      options.database.pipelineOriginAccessRule.findMany({
        where: { workspaceId: context.workspaceId },
        select: { sourceId: true, teamId: true, canRead: true },
      }),
    ]);
    const governedSources = new Set(originRules.map((rule) => rule.sourceId));
    const sourceAllowed = (sourceId: string) =>
      !governedSources.has(sourceId) ||
      originRules.some((rule) => rule.sourceId === sourceId && teamIds.has(rule.teamId) && rule.canRead);

    const taskItems = tasks.flatMap((task) => {
      const decision = activityPermission(task, decisions);
      if (!withinActivityScope(decision, context, teamMemberIds, teamIds, task.assigneeMemberId, task.queue?.teamId ?? null)) return [];
      if (decision.allowed && decision.scope !== "WORKSPACE" && !sourceAllowed(task.lead.sourceId)) return [];
      const cadence = automationCategory(task.automationRun?.actionConfigSnapshot ?? null) === "OUTREACH_CADENCE";
      const origin = task.context === "POST_SALE"
        ? "POST_SALE"
        : task.meetingId
          ? "MEETING"
          : task.stageActivityInstance
            ? "OPPORTUNITY_STAGE"
            : cadence
              ? "CADENCE"
              : task.opportunityId
                ? "OPPORTUNITY"
                : "LEAD";
      const href = task.meetingId
        ? `/agenda/reunioes/${task.meetingId}`
        : task.context === "POST_SALE" && task.lead.accountId
          ? `/customer-success?accountId=${task.lead.accountId}`
          : task.opportunityId
            ? `/oportunidades?opportunityId=${task.opportunityId}`
            : `/leads/${task.leadId}/historico#tarefas`;
      return [{
        id: task.id,
        recordType: "TASK" as const,
        leadId: task.leadId,
        leadName: task.lead.fullName,
        opportunityId: task.opportunityId,
        opportunityName: task.opportunity?.name ?? null,
        meetingId: task.meetingId,
        stageName: task.opportunity?.currentStage.name ?? task.lead.currentStage.name,
        title: task.title,
        description: task.description,
        kind: task.kind,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt.toISOString(),
        ownerMemberId: task.assigneeMemberId,
        ownerName: task.assignee?.user.displayName ?? task.queue?.name ?? "Fila sem responsável individual",
        origin,
        href,
        stageActivityInstanceId: task.stageActivityInstance?.id ?? null,
        activityType: task.stageActivityInstance?.activityType ?? null,
        script: task.stageActivityInstance?.script ?? null,
        reentryPolicy: task.stageActivityInstance?.reentryPolicy ?? null,
      }];
    });
    const meetingItems = meetings.flatMap((meeting) => {
      if (!withinActivityScope(meetingDecision, context, teamMemberIds, teamIds, meeting.ownerMemberId, null)) return [];
      if (meetingDecision.allowed && meetingDecision.scope !== "WORKSPACE" && !sourceAllowed(meeting.lead.sourceId)) return [];
      return [{
        id: `meeting:${meeting.id}`,
        recordType: "MEETING" as const,
        leadId: meeting.leadId,
        leadName: meeting.lead.fullName,
        opportunityId: meeting.opportunityId,
        opportunityName: meeting.opportunity?.name ?? null,
        meetingId: meeting.id,
        stageName: meeting.opportunity?.currentStage.name ?? null,
        title: `Reunião: ${meeting.title}`,
        description: meeting.observation,
        kind: "MEETING" as const,
        status: "OPEN" as const,
        priority: "HIGH" as const,
        dueAt: meeting.startsAt.toISOString(),
        ownerMemberId: meeting.ownerMemberId,
        ownerName: meeting.owner.user.displayName,
        origin: "MEETING" as const,
        href: `/agenda/reunioes/${meeting.id}`,
        stageActivityInstanceId: null,
        activityType: null,
        script: null,
        reentryPolicy: null,
      }];
    });
    const items = [...taskItems, ...meetingItems].sort((left, right) => left.dueAt.localeCompare(right.dueAt) || left.id.localeCompare(right.id));
    return {
      generatedAt: options.now().toISOString(),
      counts: {
        total: items.length,
        overdue: items.filter((item) => new Date(item.dueAt) < options.now()).length,
        leads: items.filter((item) => item.origin === "LEAD").length,
        cadence: items.filter((item) => item.origin === "CADENCE").length,
        meetings: items.filter((item) => item.origin === "MEETING").length,
        opportunities: items.filter((item) => item.origin === "OPPORTUNITY" || item.origin === "OPPORTUNITY_STAGE").length,
        postSale: items.filter((item) => item.origin === "POST_SALE").length,
      },
      items,
    };
  }

  return Object.freeze({ getScreen, command, scanReviews, getReviews, getActivityQueue });
}

let singleton: ReturnType<typeof createSalesGateService> | undefined;
export function getSalesGateService() {
  singleton ??= createSalesGateService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return singleton;
}
