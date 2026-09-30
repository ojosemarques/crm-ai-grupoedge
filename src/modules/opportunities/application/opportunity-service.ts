import type {
  PermissionScope,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { reconcileCommissionsInTransaction } from "@/modules/finance/application/finance-service";
import { isCatalogItemSellable } from "@/modules/catalog/domain/catalog-sellability-policy";
import { projectOpportunityOwnership } from "@/modules/lifecycle/application/lifecycle-projection-writer";
import { assertPipelineRequiredFields } from "@/modules/pipeline-templates/application/opportunity-required-fields";
import { assertConsultativeSalesGates, assertRequiredStageActivitiesComplete, instantiateStageActivities, recordGateEvaluation, supersedeOpenStageActivities } from "@/modules/opportunities/application/sales-gate-service";
import { cancelIncompatibleAccountPlanActionsInTransaction } from "@/modules/opportunities/application/account-plan-service";
import { getAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import {
  publishOpportunityClosedInTransaction,
  type TransactionalAutomationPublisher,
} from "@/modules/automations/application/lifecycle-automation-scheduler";
import type {
  LeadOpportunityScreen,
  OpportunityListItem,
  OpportunityPipelineScreen,
  OpportunityTransitionOption,
} from "@/modules/opportunities/domain/opportunity-contracts";
import {
  isOpportunityStageCode,
  opportunityStageCodes,
  opportunityStageLabel,
  opportunityStageRequiresConfirmation,
  opportunityStageRequiresNextAction,
  opportunityStageRequiresOffer,
  opportunityStatusForStage,
  type OpportunityStageCode,
} from "@/modules/opportunities/domain/opportunity-stage-policy";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import {
  parseWorkspaceLocalDateTime,
  workspaceDayRange,
} from "@/shared/core/time/workspace-time";
import { z } from "zod";

type AuthorizationPort = Readonly<{
  authorize: (
    context: AuthenticatedContext,
    permissionKey: PermissionKey,
    resource: ResourceScope,
  ) => Promise<AuthorizationDecision>;
  assertAuthorized: (
    context: AuthenticatedContext,
    permissionKey: PermissionKey,
    resource: ResourceScope,
  ) => Promise<void>;
}>;

type OpportunityServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
  automationPublisher?: TransactionalAutomationPublisher;
  beforeCommit?: () => Promise<void>;
}>;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const centsSchema = z.union([
  z.string().regex(/^\d+$/),
  z.number().int().nonnegative(),
]).transform((value) => BigInt(value));
const optionalId = z.string().uuid().nullable().optional();
const nextActionSchema = z.object({
  title: z.string().trim().min(2).max(200),
  dueAtLocal: localDateTimeSchema,
}).strict();

const pipelineQuerySchema = z.object({
  closerId: z.union([z.literal(""), z.string().uuid()]).default(""),
  productId: z.union([z.literal(""), z.string().uuid()]).default(""),
  sourceId: z.union([z.literal(""), z.string().uuid()]).default(""),
  stageCode: z.enum([...opportunityStageCodes, "ALL"]).default("ALL"),
  from: z.union([z.literal(""), dateSchema]).default(""),
  to: z.union([z.literal(""), dateSchema]).default(""),
}).strict();

const leadQuerySchema = z.object({ leadId: z.string().uuid() }).strict();

const createSchema = z.object({
  leadId: z.string().uuid(),
  accountId: optionalId,
  meetingId: z.string().uuid(),
  ownerMemberId: z.string().uuid(),
  productId: optionalId,
  interestDescription: z.string().trim().max(2_000).optional(),
  name: z.string().trim().min(2).max(200),
  amountCents: centsSchema,
  mrrCents: centsSchema,
  tcvCents: centsSchema,
  probabilityPercent: z.number().int().min(0).max(100),
  expectedCloseDate: dateSchema.optional(),
  notes: z.string().trim().max(5_000).optional(),
  nextAction: nextActionSchema,
}).strict();

const transitionSchema = z.object({
  action: z.literal("TRANSITION"),
  opportunityId: z.string().uuid(),
  targetStageId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(3).max(2_000),
  origin: z.enum(["OPPORTUNITY_BOARD", "OPPORTUNITY_LIST", "OPPORTUNITY_CARD"]),
  confirmed: z.boolean().default(false),
  lossReasonId: optionalId,
  nextAction: nextActionSchema.optional(),
}).strict();

const proposalSchema = z.object({
  action: z.literal("PROPOSAL"),
  opportunityId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  productId: z.string().uuid(),
  offerTemplateId: optionalId,
  name: z.string().trim().min(2).max(200),
  quantity: z.number().int().min(1).max(1_000),
  unitPriceCents: centsSchema,
  discountCents: centsSchema,
  validUntilDate: dateSchema.optional(),
  justification: z.string().trim().max(2_000).optional(),
  confirmed: z.boolean(),
  nextAction: nextActionSchema.optional(),
}).strict();

const reopenSchema = z.object({
  action: z.literal("REOPEN"),
  opportunityId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(3).max(2_000),
  confirmed: z.literal(true),
  nextAction: nextActionSchema,
}).strict();

function invalidInput(value: z.ZodError | string): never {
  throw new ApplicationError(
    typeof value === "string" ? value : value.issues.map((issue) => issue.message).join(" "),
    { code: "INVALID_INPUT", statusCode: 400, expose: true },
  );
}

function conflict(code: string, message: string): never {
  throw new ApplicationError(message, { code, statusCode: 409, expose: true });
}

function notFound(message: string): never {
  throw new ApplicationError(message, { code: "NOT_FOUND", statusCode: 404, expose: true });
}

function opportunityResource(
  workspaceId: string,
  opportunity: Readonly<{ id: string; ownerMemberId: string; lead?: { sourceId?: string; routingQueue?: { teamId: string | null } | null; queue?: { teamId: string | null } | null } }>,
): ResourceScope {
  return {
    workspaceId,
    resourceType: "Opportunity",
    resourceId: opportunity.id,
    opportunityId: opportunity.id,
    ...(opportunity.lead?.sourceId ? { sourceId: opportunity.lead.sourceId } : {}),
    ownerMemberId: opportunity.ownerMemberId,
    teamId: opportunity.lead?.routingQueue?.teamId ?? opportunity.lead?.queue?.teamId ?? null,
  };
}

function leadResource(
  workspaceId: string,
  lead: Readonly<{
    id: string;
    sourceId?: string;
    ownerMemberId: string | null;
    queueId: string | null;
    routingQueue?: { teamId: string | null } | null;
    queue?: { teamId: string | null } | null;
  }>,
): ResourceScope {
  return {
    workspaceId,
    resourceType: "Lead",
    resourceId: lead.id,
    ...(lead.sourceId ? { sourceId: lead.sourceId } : {}),
    ownerMemberId: lead.ownerMemberId,
    queueId: lead.queueId,
    teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null,
  };
}

async function lockOpportunity(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  opportunityId: string,
) {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`opportunity:${workspaceId}:${opportunityId}`}, 0)
    )
  `;
}

async function activeOpportunityTask(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  opportunityId: string,
) {
  return transaction.task.findFirst({
    where: {
      workspaceId,
      opportunityId,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      deletedAt: null,
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, dueAt: true },
  });
}

function opportunityTaskProjection(
  task: Awaited<ReturnType<typeof activeOpportunityTask>>,
) {
  return task
    ? {
        nextActionTaskId: task.id,
        nextActionAt: task.dueAt,
        nextActionDescription: task.title,
      }
    : {
        nextActionTaskId: null,
        nextActionAt: null,
        nextActionDescription: null,
      };
}

async function activeLeadTask(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  leadId: string,
) {
  return transaction.task.findFirst({
    where: { workspaceId, leadId, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, dueAt: true },
  });
}

function leadTaskProjection(task: Awaited<ReturnType<typeof activeLeadTask>>) {
  return task
    ? { nextActionTaskId: task.id, nextActionAt: task.dueAt, nextActionDescription: task.title }
    : { nextActionTaskId: null, nextActionAt: null, nextActionDescription: null };
}

async function createOpportunityTask(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    workspaceId: string;
    leadId: string;
    opportunityId: string;
    ownerMemberId: string;
    actorId: string;
    title: string;
    dueAt: Date;
    now: Date;
  }>,
) {
  if (input.dueAt <= input.now) invalidInput("A próxima ação deve estar no futuro.");
  return transaction.task.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      opportunityId: input.opportunityId,
      assigneeMemberId: input.ownerMemberId,
      title: input.title,
      kind: "FOLLOW_UP",
      status: "OPEN",
      priority: "HIGH",
      dueAt: input.dueAt,
      createdByActorId: input.actorId,
      updatedByActorId: input.actorId,
      createdAt: input.now,
      updatedAt: input.now,
    },
  });
}

async function getWorkspaceTimeZone(database: PrismaClient, workspaceId: string) {
  const workspace = await database.workspace.findFirst({
    where: { id: workspaceId, status: "ACTIVE", deletedAt: null },
    select: { timeZone: true },
  });
  if (!workspace) notFound("Workspace não encontrado.");
  return workspace.timeZone;
}

async function getOpportunityPipeline(database: PrismaClient | Prisma.TransactionClient, workspaceId: string) {
  const pipeline = await database.pipeline.findFirst({
    where: { workspaceId, entityType: "OPPORTUNITY", isDefault: true, deletedAt: null },
    include: {
      stages: {
        where: { deletedAt: null },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      },
      transitions: {
        orderBy: [{ fromStageId: "asc" }, { toStageId: "asc" }],
        select: { fromStageId: true, toStageId: true, active: true },
      },
    },
  });
  if (!pipeline) notFound("Pipeline padrão de vendas não encontrado.");
  const codes = new Set(pipeline.stages.flatMap((stage) =>
    isOpportunityStageCode(stage.opportunityStageCode) ? [stage.opportunityStageCode] : [],
  ));
  if (codes.size !== opportunityStageCodes.length || opportunityStageCodes.some((code) => !codes.has(code))) {
    conflict("PIPELINE_CONFIGURATION_INVALID", "O pipeline de vendas não possui as sete etapas operacionais exigidas.");
  }
  return pipeline;
}

async function teamOwnerIds(database: PrismaClient, context: AuthenticatedContext) {
  const teams = await database.teamMember.findMany({
    where: {
      workspaceId: context.workspaceId,
      workspaceMemberId: context.memberId,
      deletedAt: null,
    },
    select: { teamId: true },
  });
  if (teams.length === 0) return [];
  const members = await database.teamMember.findMany({
    where: {
      workspaceId: context.workspaceId,
      teamId: { in: teams.map((item) => item.teamId) },
      function: { in: ["CLOSER", "MANAGER"] },
      deletedAt: null,
      member: { status: "ACTIVE", deletedAt: null, user: { status: "ACTIVE", deletedAt: null } },
    },
    distinct: ["workspaceMemberId"],
    select: { workspaceMemberId: true },
  });
  return members.map((item) => item.workspaceMemberId);
}

async function resolveScope(
  database: PrismaClient,
  authorization: AuthorizationPort,
  context: AuthenticatedContext,
  permission: PermissionKey,
) {
  const decision = await authorization.authorize(context, permission, {
    workspaceId: context.workspaceId,
    resourceType: "OpportunityPipeline",
    ownerMemberId: context.memberId,
  });
  if (!decision.allowed) {
    await authorization.assertAuthorized(context, permission, {
      workspaceId: context.workspaceId,
      resourceType: "OpportunityPipeline",
      ownerMemberId: context.memberId,
    });
    throw new Error("Unreachable authorization branch");
  }
  const ownerIds = decision.scope === "TEAM" ? await teamOwnerIds(database, context) : [];
  return { scope: decision.scope, ownerIds };
}

function scopeWhere(scope: PermissionScope, context: AuthenticatedContext, ownerIds: readonly string[]) {
  if (scope === "WORKSPACE") return {};
  if (scope === "OWN") return { ownerMemberId: context.memberId };
  return { ownerMemberId: { in: [...ownerIds] } };
}

async function originVisibility(
  database: PrismaClient,
  context: AuthenticatedContext,
  scope: PermissionScope,
) {
  if (scope === "WORKSPACE") return { governedSourceIds: [] as string[], allowedSourceIds: [] as string[] };
  const memberships = await database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } });
  const rules = await database.pipelineOriginAccessRule.findMany({ where: { workspaceId: context.workspaceId }, select: { sourceId: true, teamId: true, canRead: true } });
  const teams = new Set(memberships.map((item) => item.teamId));
  return {
    governedSourceIds: [...new Set(rules.map((rule) => rule.sourceId))],
    allowedSourceIds: [...new Set(rules.filter((rule) => rule.canRead && teams.has(rule.teamId)).map((rule) => rule.sourceId))],
  };
}

function originVisibilityWhere(scope: PermissionScope, visibility: Awaited<ReturnType<typeof originVisibility>>): Prisma.OpportunityWhereInput {
  if (scope === "WORKSPACE" || visibility.governedSourceIds.length === 0) return {};
  return { OR: [{ lead: { sourceId: { notIn: visibility.governedSourceIds } } }, { lead: { sourceId: { in: visibility.allowedSourceIds } } }] };
}

async function assertOriginCapability(
  database: PrismaClient | Prisma.TransactionClient,
  context: AuthenticatedContext,
  decision: AuthorizationDecision,
  sourceId: string,
  capability: "canTransition" | "canReassign",
) {
  if (!decision.allowed) throw new ApplicationError("Acesso negado.", { code: "ACCESS_DENIED", statusCode: 403, expose: true });
  if (decision.scope === "WORKSPACE") return;
  const rules = await database.pipelineOriginAccessRule.findMany({ where: { workspaceId: context.workspaceId, sourceId }, select: { teamId: true, canTransition: true, canReassign: true } });
  if (!rules.length) return;
  const memberships = await database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } });
  const teams = new Set(memberships.map((item) => item.teamId));
  if (!rules.some((rule) => teams.has(rule.teamId) && rule[capability])) throw new ApplicationError("A origem não permite esta ação para sua equipe.", { code: "ORIGIN_TEAM_DENIED", statusCode: 403, expose: true });
}

async function referenceOptions(
  database: PrismaClient,
  context: AuthenticatedContext,
  scope: PermissionScope,
  ownerIds: readonly string[],
) {
  const [closers, products, reasons] = await Promise.all([
    database.workspaceMember.findMany({
      where: {
        workspaceId: context.workspaceId,
        status: "ACTIVE",
        deletedAt: null,
        user: { status: "ACTIVE", deletedAt: null },
        ...(scope === "TEAM" ? { id: { in: [...ownerIds] } } : {}),
        teamMemberships: {
          some: {
            function: "CLOSER",
            deletedAt: null,
          },
        },
        ...(scope === "OWN" ? { id: context.memberId } : {}),
      },
      orderBy: { user: { displayName: "asc" } },
      select: { id: true, user: { select: { displayName: true } } },
    }),
    database.product.findMany({
      where: { workspaceId: context.workspaceId, active: true, deletedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    }),
    database.lossReason.findMany({
      where: { workspaceId: context.workspaceId, active: true, deletedAt: null },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);
  return {
    closerOptions: closers.map((item) => ({ id: item.id, name: item.user.displayName })),
    productOptions: products,
    lossReasons: reasons,
  };
}

type OpportunityRow = Prisma.OpportunityGetPayload<{
  include: {
  lead: { select: { fullName: true; sourceId: true; source: { select: { name: true } }; routingQueue: { select: { teamId: true } }; queue: { select: { teamId: true } } } };
    account: { select: { name: true } };
    owner: { select: { user: { select: { displayName: true } } } };
    product: { select: { name: true } };
    currentStage: true;
    lossReason: { select: { name: true } };
    stageHistory: { where: { exitedAt: null }; take: 1; orderBy: { enteredAt: "desc" } };
    tasks: { where: { status: { in: ["OPEN", "IN_PROGRESS"] }; deletedAt: null }; take: 1; orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }] };
    meetings: { where: { status: "COMPLETED" }; take: 1 };
    offers: { where: { deletedAt: null }; orderBy: [{ createdAt: "desc" }, { id: "desc" }]; include: { product: { select: { name: true } }; lines: { orderBy: { position: "asc" } } } };
  };
}>;

function transitionOptions(
  stages: readonly Readonly<{ id: string; name: string; opportunityStageCode: string | null }>[] ,
  transitions: readonly Readonly<{ fromStageId: string; toStageId: string; active: boolean }>[],
  row: OpportunityRow,
): OpportunityTransitionOption[] {
  if (!isOpportunityStageCode(row.currentStage.opportunityStageCode)) return [];
  const current = row.currentStage.opportunityStageCode;
  const hasNextAction = row.tasks.length > 0;
  const hasOffer = row.offers.length > 0;
  const meetingHeld = current !== "MEETING_SCHEDULED" || row.meetings.length > 0;
  return stages.flatMap((stage) => {
    if (!isOpportunityStageCode(stage.opportunityStageCode) || stage.opportunityStageCode === current) return [];
    const code = stage.opportunityStageCode;
    let blockReason: string | null = null;
    if (!transitions.some((transition) => transition.active && transition.fromStageId === row.currentStageId && transition.toStageId === stage.id)) blockReason = "Transição fora da sequência comercial configurada.";
    else if (code === "MEETING_HELD" && !meetingHeld) blockReason = "Registre o comparecimento da reunião.";
    else if (code === "PROPOSAL") blockReason = "Registre a proposta pelo formulário próprio.";
    else if (opportunityStageRequiresOffer(code) && !hasOffer) blockReason = "Registre uma proposta antes desta etapa.";
    else if (opportunityStageRequiresNextAction(code) && !hasNextAction) blockReason = "Crie uma próxima ação antes da transição.";
    else if (code === "WON" && (!row.productId || row.amountCents <= 0n || row.tcvCents <= 0n)) blockReason = "Ganho exige produto, valor e TCV positivos.";
    return [{
      stageId: stage.id,
      code,
      name: stage.name,
      allowed: blockReason === null,
      blockReason,
      requiresConfirmation: opportunityStageRequiresConfirmation(code),
      requiresLossReason: code === "LOST",
    }];
  });
}

function serializeOpportunity(
  row: OpportunityRow,
  stages: readonly Readonly<{ id: string; name: string; opportunityStageCode: string | null }>[],
  transitions: readonly Readonly<{ fromStageId: string; toStageId: string; active: boolean }>[],
  canWrite: boolean,
  canReopen: boolean,
): OpportunityListItem {
  if (!isOpportunityStageCode(row.currentStage.opportunityStageCode)) {
    conflict("PIPELINE_CONFIGURATION_INVALID", "A oportunidade está em uma etapa sem código operacional.");
  }
  const task = row.tasks[0] ?? null;
  return {
    id: row.id,
    leadId: row.leadId,
    leadName: row.lead.fullName,
    sourceId: row.lead.sourceId,
    sourceName: row.lead.source.name,
    accountId: row.accountId,
    accountName: row.account?.name ?? null,
    ownerMemberId: row.ownerMemberId,
    ownerName: row.owner.user.displayName,
    productId: row.productId,
    productName: row.product?.name ?? null,
    interestDescription: row.interestDescription,
    name: row.name,
    status: row.status,
    stageId: row.currentStageId,
    stageCode: row.currentStage.opportunityStageCode,
    stageName: row.currentStage.name,
    stageEnteredAt: (row.stageHistory[0]?.enteredAt ?? row.createdAt).toISOString(),
    amountCents: row.amountCents.toString(),
    mrrCents: row.mrrCents.toString(),
    tcvCents: row.tcvCents.toString(),
    probabilityPercent: Math.round(row.probabilityBps / 100),
    expectedCloseAt: row.expectedCloseAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    nextActionAt: task?.dueAt.toISOString() ?? null,
    nextActionDescription: task?.title ?? null,
    lossReasonName: row.lossReason?.name ?? null,
    notes: row.commercialNotes,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
    offers: row.offers.map((offer) => ({
      id: offer.id,
      name: offer.name,
      productName: offer.product.name,
      totalCents: offer.totalCents.toString(),
      validUntil: offer.validUntil?.toISOString() ?? null,
      acceptedAt: offer.acceptedAt?.toISOString() ?? null,
      justification: offer.justification,
      createdAt: offer.createdAt.toISOString(),
      lines: offer.lines.map((line) => ({ productName: line.productNameSnapshot, productVersion: line.productVersionSnapshot, revenueCategory: line.revenueCategorySnapshot, quantity: line.quantity, totalCents: line.totalCents.toString() })),
    })),
    transitions: transitionOptions(stages, transitions, row),
    canWrite,
    canReopen,
  };
}

const opportunityInclude = {
  lead: { select: { fullName: true, sourceId: true, source: { select: { name: true } }, routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } },
  account: { select: { name: true } },
  owner: { select: { user: { select: { displayName: true } } } },
  product: { select: { name: true } },
  currentStage: true,
  lossReason: { select: { name: true } },
  stageHistory: { where: { exitedAt: null }, take: 1, orderBy: { enteredAt: "desc" as const } },
  tasks: {
    where: { status: { in: ["OPEN" as const, "IN_PROGRESS" as const] }, deletedAt: null },
    take: 1,
    orderBy: [{ dueAt: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }],
  },
  meetings: { where: { status: "COMPLETED" }, take: 1 },
  offers: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    include: { product: { select: { name: true } }, lines: { orderBy: { position: "asc" } } },
  },
} satisfies Prisma.OpportunityInclude;

export async function recordOpportunityMeetingHeldInTransaction(
  transaction: Prisma.TransactionClient,
  context: AuthenticatedContext,
  opportunityId: string,
  occurredAt: Date,
) {
  await lockOpportunity(transaction, context.workspaceId, opportunityId);
  const opportunity = await transaction.opportunity.findFirst({
    where: { id: opportunityId, workspaceId: context.workspaceId, deletedAt: null, status: "OPEN" },
    include: {
      currentStage: true,
      stageHistory: { where: { exitedAt: null }, take: 1, orderBy: { enteredAt: "desc" } },
    },
  });
  if (!opportunity || opportunity.currentStage.opportunityStageCode !== "MEETING_SCHEDULED") return;
  const target = await transaction.pipelineStage.findFirst({
    where: {
      workspaceId: context.workspaceId,
      pipelineId: opportunity.pipelineId,
      opportunityStageCode: "MEETING_HELD",
      deletedAt: null,
    },
  });
  const history = opportunity.stageHistory[0];
  if (!target || !history || history.stageId !== opportunity.currentStageId) {
    conflict("STAGE_HISTORY_INCONSISTENT", "O histórico da oportunidade está inconsistente.");
  }
  const configuredTransition = await transaction.pipelineStageTransition.findFirst({
    where: {
      workspaceId: context.workspaceId,
      pipelineId: opportunity.pipelineId,
      fromStageId: opportunity.currentStageId,
      toStageId: target.id,
      active: true,
    },
    select: { id: true },
  });
  if (!configuredTransition) conflict("INVALID_OPPORTUNITY_TRANSITION", "A transição para reunião realizada está desativada nas configurações.");
  const nextTask = await activeOpportunityTask(transaction, context.workspaceId, opportunity.id);
  if (!nextTask) conflict("NEXT_ACTION_REQUIRED", "A oportunidade precisa de próxima ação após a reunião.");
  const effectiveAt = occurredAt > history.enteredAt ? occurredAt : new Date(history.enteredAt.getTime() + 1);
  await assertRequiredStageActivitiesComplete(transaction, context.workspaceId, opportunity.id);
  const gateSnapshot = await assertConsultativeSalesGates(transaction, opportunity.id, "MEETING_HELD");
  await supersedeOpenStageActivities(transaction, context.workspaceId, opportunity.id, context.actorId, effectiveAt);
  await transaction.stageHistory.update({
    where: { id: history.id },
    data: { exitedAt: effectiveAt, exitedByActorId: context.actorId },
  });
  const enteredHistory = await transaction.stageHistory.create({
    data: {
      workspaceId: context.workspaceId,
      pipelineId: opportunity.pipelineId,
      stageId: target.id,
      opportunityId: opportunity.id,
      enteredAt: effectiveAt,
      enteredByActorId: context.actorId,
      transitionOrigin: "MEETING",
      transitionReason: "Comparecimento registrado na reunião vinculada.",
    },
  });
  await recordGateEvaluation(transaction, { workspaceId: context.workspaceId, opportunityId: opportunity.id, stageHistoryId: enteredHistory.id, targetStageCode: "MEETING_HELD", actorId: context.actorId, evaluatedAt: effectiveAt, snapshot: gateSnapshot });
  await instantiateStageActivities(transaction, { workspaceId: context.workspaceId, opportunityId: opportunity.id, leadId: opportunity.leadId, ownerMemberId: opportunity.ownerMemberId, pipelineId: opportunity.pipelineId, stageId: target.id, stageHistoryId: enteredHistory.id, actorId: context.actorId, enteredAt: effectiveAt });
  await transaction.opportunity.update({
    where: { id: opportunity.id },
    data: {
      currentStageId: target.id,
      ...opportunityTaskProjection(nextTask),
      revision: { increment: 1 },
      updatedByActorId: context.actorId,
      updatedAt: effectiveAt,
    },
  });
  await transaction.activity.create({
    data: {
      workspaceId: context.workspaceId,
      leadId: opportunity.leadId,
      opportunityId: opportunity.id,
      type: "STAGE_CHANGE",
      direction: "INTERNAL",
      result: "INFORMATION",
      subject: `Oportunidade: ${opportunityStageLabel("MEETING_HELD")}`,
      description: "Comparecimento registrado na reunião vinculada.",
      occurredAt: effectiveAt,
      nextActionAt: nextTask.dueAt,
      nextActionDescription: nextTask.title,
      previousValues: { stageCode: "MEETING_SCHEDULED" },
      newValues: { stageCode: "MEETING_HELD" },
      createdByActorId: context.actorId,
      updatedByActorId: context.actorId,
      createdAt: effectiveAt,
      updatedAt: effectiveAt,
    },
  });
  await transaction.auditLog.create({
    data: {
      workspaceId: context.workspaceId,
      actorId: context.actorId,
      action: "opportunity.meeting_held",
      entityType: "Opportunity",
      entityId: opportunity.id,
      occurredAt: effectiveAt,
      changes: { from: "MEETING_SCHEDULED", to: "MEETING_HELD" },
      metadata: { origin: "MEETING" },
    },
  });
  await transaction.lead.update({
    where: { id: opportunity.leadId },
    data: {
      lastActivityAt: effectiveAt,
      updatedByActorId: context.actorId,
      updatedAt: effectiveAt,
    },
  });
}

export function createOpportunityService(options: OpportunityServiceOptions) {
  async function permissionsForRows(context: AuthenticatedContext, rows: readonly OpportunityRow[]) {
    return Promise.all(rows.map(async (row) => {
      const resource = opportunityResource(context.workspaceId, row);
      const [write, reopen] = await Promise.all([
        options.authorization.authorize(context, PermissionKeys.OPPORTUNITIES_WRITE, resource),
        options.authorization.authorize(context, PermissionKeys.LEADS_ASSIGN, resource),
      ]);
      let originAllowed = write.allowed;
      if (write.allowed) {
        try { await assertOriginCapability(options.database, context, write, row.lead.sourceId, "canTransition"); }
        catch { originAllowed = false; }
      }
      return { canWrite: originAllowed, canReopen: originAllowed && reopen.allowed };
    }));
  }

  async function getPipelineScreen(
    context: AuthenticatedContext,
    payload: unknown,
  ): Promise<OpportunityPipelineScreen> {
    const parsed = pipelineQuerySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const [timeZone, readScope, pipeline] = await Promise.all([
      getWorkspaceTimeZone(options.database, context.workspaceId),
      resolveScope(options.database, options.authorization, context, PermissionKeys.OPPORTUNITIES_READ),
      getOpportunityPipeline(options.database, context.workspaceId),
    ]);
    const writeScope = await options.authorization.authorize(context, PermissionKeys.OPPORTUNITIES_WRITE, {
      workspaceId: context.workspaceId,
      resourceType: "OpportunityPipeline",
      ownerMemberId: context.memberId,
    });
    const visibility = await originVisibility(options.database, context, readScope.scope);
    const refs = await referenceOptions(options.database, context, readScope.scope, readScope.ownerIds);
    if (parsed.data.closerId && !refs.closerOptions.some((item) => item.id === parsed.data.closerId)) {
      await options.authorization.assertAuthorized(context, PermissionKeys.OPPORTUNITIES_READ, {
        workspaceId: context.workspaceId,
        resourceType: "Opportunity",
        ownerMemberId: parsed.data.closerId,
      });
    }
    if (parsed.data.productId && !refs.productOptions.some((item) => item.id === parsed.data.productId)) {
      notFound("Produto não encontrado.");
    }
    const sourceOptions = await options.database.leadSource.findMany({
      where: {
        workspaceId: context.workspaceId,
        deletedAt: null,
        ...(readScope.scope === "WORKSPACE" || visibility.governedSourceIds.length === 0 ? {} : { OR: [{ id: { notIn: visibility.governedSourceIds } }, { id: { in: visibility.allowedSourceIds } }] }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    if (parsed.data.sourceId && !sourceOptions.some((item) => item.id === parsed.data.sourceId)) notFound("Origem não encontrada ou não autorizada.");
    let dateFilter: Prisma.DateTimeFilter | undefined;
    if (parsed.data.from || parsed.data.to) {
      const start = parsed.data.from ? workspaceDayRange(parsed.data.from, timeZone).start : undefined;
      const end = parsed.data.to ? workspaceDayRange(parsed.data.to, timeZone).end : undefined;
      if (start && end && start >= end) invalidInput("O período final deve ser posterior ao inicial.");
      dateFilter = { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) };
    }
    const where: Prisma.OpportunityWhereInput = {
      workspaceId: context.workspaceId,
      deletedAt: null,
      ...scopeWhere(readScope.scope, context, readScope.ownerIds),
      ...originVisibilityWhere(readScope.scope, visibility),
      ...(parsed.data.closerId ? { ownerMemberId: parsed.data.closerId } : {}),
      ...(parsed.data.productId ? { productId: parsed.data.productId } : {}),
      ...(parsed.data.sourceId ? { lead: { sourceId: parsed.data.sourceId } } : {}),
      ...(parsed.data.stageCode !== "ALL" ? { currentStage: { opportunityStageCode: parsed.data.stageCode } } : {}),
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };
    const rows = await options.database.opportunity.findMany({
      where,
      include: opportunityInclude,
      orderBy: [{ nextActionAt: "asc" }, { updatedAt: "desc" }, { id: "asc" }],
    });
    const permissions = await permissionsForRows(context, rows);
    const rowsByStage = new Map<OpportunityStageCode, OpportunityListItem[]>();
    for (const [index, row] of rows.entries()) {
      if (!isOpportunityStageCode(row.currentStage.opportunityStageCode)) {
        conflict("PIPELINE_CONFIGURATION_INVALID", "Uma oportunidade está em etapa sem código operacional.");
      }
      const list = rowsByStage.get(row.currentStage.opportunityStageCode) ?? [];
      const permission = permissions[index] ?? { canWrite: false, canReopen: false };
      list.push(serializeOpportunity(row, pipeline.stages, pipeline.transitions, permission.canWrite, permission.canReopen));
      rowsByStage.set(row.currentStage.opportunityStageCode, list);
    }
    return {
      generatedAt: options.now().toISOString(),
      timeZone,
      filters: parsed.data,
      canWrite: writeScope.allowed,
      canFilterCloser: readScope.scope !== "OWN",
      closerOptions: refs.closerOptions,
      productOptions: refs.productOptions,
      sourceOptions,
      lossReasons: refs.lossReasons,
      stages: pipeline.stages.flatMap((stage) =>
        isOpportunityStageCode(stage.opportunityStageCode)
          ? [{
              id: stage.id,
              code: stage.opportunityStageCode,
              name: stage.name,
              position: stage.position,
              type: stage.type,
              count: rowsByStage.get(stage.opportunityStageCode)?.length ?? 0,
              opportunities: rowsByStage.get(stage.opportunityStageCode) ?? [],
            }]
          : [],
      ),
    };
  }

  async function getLeadScreen(
    context: AuthenticatedContext,
    payload: unknown,
  ): Promise<LeadOpportunityScreen> {
    const parsed = leadQuerySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await options.database.lead.findFirst({
      where: { id: parsed.data.leadId, workspaceId: context.workspaceId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        accountId: true,
        ownerMemberId: true,
        queueId: true,
        routingQueue: { select: { teamId: true } },
        queue: { select: { teamId: true } },
      },
    });
    if (!lead) notFound("Lead não encontrado.");
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.LEADS_READ,
      leadResource(context.workspaceId, lead),
    );
    const timeZone = await getWorkspaceTimeZone(options.database, context.workspaceId);
    const readDecision = await options.authorization.authorize(context, PermissionKeys.OPPORTUNITIES_READ, {
      workspaceId: context.workspaceId,
      resourceType: "Opportunity",
      ownerMemberId: context.memberId,
    });
    if (!readDecision.allowed) {
      return {
        leadId: lead.id,
        leadName: lead.fullName,
        timeZone,
        canRead: false,
        canCreate: false,
        accountOptions: [],
        suggestedAccountId: lead.accountId,
        closerOptions: [],
        productOptions: [],
        offerTemplateOptions: [],
        meetingOptions: [],
        lossReasons: [],
        opportunities: [],
      };
    }
    const readScope = {
      scope: readDecision.scope,
      ownerIds: readDecision.scope === "TEAM"
        ? await teamOwnerIds(options.database, context)
        : [],
    };
    const pipeline = await getOpportunityPipeline(options.database, context.workspaceId);
    const rows = await options.database.opportunity.findMany({
      where: {
        workspaceId: context.workspaceId,
        leadId: lead.id,
        deletedAt: null,
        ...scopeWhere(readScope.scope, context, readScope.ownerIds),
      },
      include: opportunityInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const permissions = await permissionsForRows(context, rows);
    const createDecision = await options.authorization.authorize(
      context,
      PermissionKeys.OPPORTUNITIES_WRITE,
      {
        workspaceId: context.workspaceId,
        resourceType: "Opportunity",
        ownerMemberId: context.memberId,
      },
    );
    const refs = await referenceOptions(options.database, context, readScope.scope, readScope.ownerIds);
    const [products, templates, meetings, accounts] = await Promise.all([
      options.database.product.findMany({
        where: { workspaceId: context.workspaceId, active: true, audience: "INSTITUTIONAL", availability: { in: ["AVAILABLE", "CAPACITY_LIMITED"] }, deletedAt: null },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, listPriceCents: true },
      }),
      options.database.offerTemplate.findMany({
        where: { workspaceId: context.workspaceId, active: true, availability: { in: ["AVAILABLE", "CAPACITY_LIMITED"] }, deletedAt: null },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, productId: true, name: true, priceCents: true, discountCents: true, validDays: true },
      }),
      options.database.meeting.findMany({
        where: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          opportunityId: null,
          status: { in: ["SCHEDULED", "CONFIRMED", "COMPLETED"] },
          deletedAt: null,
        },
        orderBy: [{ startsAt: "desc" }, { id: "desc" }],
        select: { id: true, title: true, status: true, ownerMemberId: true, startsAt: true },
      }),
      options.database.account.findMany({
        where: { workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true },
        take: 250,
      }),
    ]);
    return {
      leadId: lead.id,
      leadName: lead.fullName,
      timeZone,
      canRead: true,
      canCreate: createDecision.allowed && meetings.length > 0 && refs.closerOptions.length > 0,
      accountOptions: accounts,
      suggestedAccountId: lead.accountId,
      closerOptions: refs.closerOptions,
      productOptions: products.map((item) => ({ ...item, listPriceCents: item.listPriceCents.toString() })),
      offerTemplateOptions: templates.map((item) => ({
        ...item,
        priceCents: item.priceCents.toString(),
        discountCents: item.discountCents.toString(),
      })),
      meetingOptions: meetings.flatMap((item) =>
        item.status === "SCHEDULED" || item.status === "CONFIRMED" || item.status === "COMPLETED"
          ? [{ ...item, status: item.status, startsAt: item.startsAt.toISOString() }]
          : [],
      ),
      lossReasons: refs.lossReasons,
      opportunities: rows.map((row, index) => {
        const permission = permissions[index] ?? { canWrite: false, canReopen: false };
        return serializeOpportunity(row, pipeline.stages, pipeline.transitions, permission.canWrite, permission.canReopen);
      }),
    };
  }

  async function create(context: AuthenticatedContext, payload: unknown) {
    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    if (!parsed.data.productId && !parsed.data.interestDescription) {
      invalidInput("Selecione um produto ou descreva o interesse comercial.");
    }
    const timeZone = await getWorkspaceTimeZone(options.database, context.workspaceId);
    const nextDueAt = parseWorkspaceLocalDateTime(parsed.data.nextAction.dueAtLocal, timeZone);
    const expectedCloseAt = parsed.data.expectedCloseDate
      ? parseWorkspaceLocalDateTime(`${parsed.data.expectedCloseDate}T12:00`, timeZone)
      : null;
    const lead = await options.database.lead.findFirst({
      where: { id: parsed.data.leadId, workspaceId: context.workspaceId, deletedAt: null },
      select: {
        id: true,
        ownerMemberId: true,
        queueId: true,
        routingQueue: { select: { teamId: true } },
        queue: { select: { teamId: true } },
      },
    });
    if (!lead) notFound("Lead não encontrado.");
    await options.authorization.assertAuthorized(context, PermissionKeys.OPPORTUNITIES_WRITE, {
      workspaceId: context.workspaceId,
      resourceType: "Opportunity",
      ownerMemberId: parsed.data.ownerMemberId,
    });
    const now = options.now();
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`lead-opportunity:${context.workspaceId}:${lead.id}`}, 0))
      `;
      const [pipeline, closer, meeting, product, account] = await Promise.all([
        getOpportunityPipeline(transaction, context.workspaceId),
        transaction.workspaceMember.findFirst({
          where: {
            id: parsed.data.ownerMemberId,
            workspaceId: context.workspaceId,
            status: "ACTIVE",
            deletedAt: null,
            user: { status: "ACTIVE", deletedAt: null },
            teamMemberships: { some: { function: "CLOSER", deletedAt: null } },
          },
          select: { id: true },
        }),
        transaction.meeting.findFirst({
          where: {
            id: parsed.data.meetingId,
            workspaceId: context.workspaceId,
            leadId: lead.id,
            opportunityId: null,
            status: { in: ["SCHEDULED", "CONFIRMED", "COMPLETED"] },
            deletedAt: null,
          },
        }),
        parsed.data.productId
          ? transaction.product.findFirst({
              where: { id: parsed.data.productId, workspaceId: context.workspaceId, active: true, deletedAt: null },
              select: { id: true },
            })
          : Promise.resolve(null),
        parsed.data.accountId
          ? transaction.account.findFirst({
              where: { id: parsed.data.accountId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);
      if (!closer) notFound("Closer não encontrado ou inativo.");
      if (!meeting) notFound("Reunião elegível não encontrada para este lead.");
      if (parsed.data.productId && !product) notFound("Produto não encontrado ou inativo.");
      if (parsed.data.accountId && !account) notFound("Conta não encontrada ou inativa.");
      const initialCode: OpportunityStageCode = meeting.status === "COMPLETED"
        ? "MEETING_HELD"
        : "MEETING_SCHEDULED";
      const initialStage = pipeline.stages.find((stage) => stage.opportunityStageCode === initialCode);
      if (!initialStage) conflict("PIPELINE_CONFIGURATION_INVALID", "Etapa inicial de vendas não encontrada.");
      const opportunity = await transaction.opportunity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          accountId: account?.id ?? null,
          pipelineId: pipeline.id,
          currentStageId: initialStage.id,
          ownerMemberId: closer.id,
          productId: product?.id ?? null,
          name: parsed.data.name,
          interestDescription: parsed.data.interestDescription ?? null,
          status: "OPEN",
          amountCents: parsed.data.amountCents,
          mrrCents: parsed.data.mrrCents,
          tcvCents: parsed.data.tcvCents,
          probabilityBps: parsed.data.probabilityPercent * 100,
          expectedCloseAt,
          commercialNotes: parsed.data.notes ?? null,
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: now,
          updatedAt: now,
        },
      });
      await projectOpportunityOwnership(transaction, {
        workspaceId: context.workspaceId,
        opportunityId: opportunity.id,
        leadId: lead.id,
        memberId: closer.id,
        actorId: context.actorId,
        occurredAt: now,
      });
      await transaction.meeting.update({
        where: { id: meeting.id },
        data: { opportunityId: opportunity.id, updatedByActorId: context.actorId, updatedAt: now },
      });
      const task = await createOpportunityTask(transaction, {
        workspaceId: context.workspaceId,
        leadId: lead.id,
        opportunityId: opportunity.id,
        ownerMemberId: closer.id,
        actorId: context.actorId,
        title: parsed.data.nextAction.title,
        dueAt: nextDueAt,
        now,
      });
      await transaction.opportunity.update({
        where: { id: opportunity.id },
        data: { ...opportunityTaskProjection(task), updatedByActorId: context.actorId, updatedAt: now },
      });
      const initialHistory = await transaction.stageHistory.create({
        data: {
          workspaceId: context.workspaceId,
          pipelineId: pipeline.id,
          stageId: initialStage.id,
          opportunityId: opportunity.id,
          enteredAt: now,
          enteredByActorId: context.actorId,
          transitionOrigin: "OPPORTUNITY_CARD",
          transitionReason: "Oportunidade criada a partir da reunião vinculada.",
        },
      });
      await instantiateStageActivities(transaction, { workspaceId: context.workspaceId, opportunityId: opportunity.id, leadId: lead.id, ownerMemberId: closer.id, pipelineId: pipeline.id, stageId: initialStage.id, stageHistoryId: initialHistory.id, actorId: context.actorId, enteredAt: now });
      const activity = await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          opportunityId: opportunity.id,
          meetingId: meeting.id,
          type: "STAGE_CHANGE",
          direction: "INTERNAL",
          result: "INFORMATION",
          subject: `Oportunidade criada: ${parsed.data.name}`,
          description: parsed.data.notes ?? parsed.data.interestDescription ?? null,
          occurredAt: now,
          nextActionAt: task.dueAt,
          nextActionDescription: task.title,
          newValues: {
            stageCode: initialCode,
            productId: product?.id ?? null,
            amountCents: parsed.data.amountCents.toString(),
            mrrCents: parsed.data.mrrCents.toString(),
            tcvCents: parsed.data.tcvCents.toString(),
          },
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: now,
          updatedAt: now,
        },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "opportunity.created",
          entityType: "Opportunity",
          entityId: opportunity.id,
          occurredAt: now,
          changes: { leadId: lead.id, meetingId: meeting.id, stageCode: initialCode, taskId: task.id, activityId: activity.id },
          metadata: { origin: "OPPORTUNITY_CARD" },
        },
      });
      const leadTask = await activeLeadTask(transaction, context.workspaceId, lead.id);
      await transaction.lead.update({
        where: { id: lead.id },
        data: { ...leadTaskProjection(leadTask), lastActivityAt: now, updatedByActorId: context.actorId, updatedAt: now },
      });
      await options.beforeCommit?.();
      return { opportunityId: opportunity.id, revision: opportunity.revision };
    });
  }

  async function transition(context: AuthenticatedContext, payload: unknown) {
    const parsed = transitionSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const authRow = await options.database.opportunity.findFirst({
      where: { id: parsed.data.opportunityId, workspaceId: context.workspaceId, deletedAt: null },
      select: { id: true, ownerMemberId: true, lead: { select: { sourceId: true, routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } } },
    });
    if (!authRow) notFound("Oportunidade não encontrada.");
    const originDecision = await options.authorization.authorize(context, PermissionKeys.OPPORTUNITIES_WRITE, opportunityResource(context.workspaceId, authRow));
    if (!originDecision.allowed) await options.authorization.assertAuthorized(context, PermissionKeys.OPPORTUNITIES_WRITE, opportunityResource(context.workspaceId, authRow));
    await assertOriginCapability(options.database, context, originDecision, authRow.lead.sourceId, "canTransition");
    const timeZone = await getWorkspaceTimeZone(options.database, context.workspaceId);
    const now = options.now();
    return options.database.$transaction(async (transaction) => {
      await lockOpportunity(transaction, context.workspaceId, authRow.id);
      const opportunity = await transaction.opportunity.findFirst({
        where: { id: authRow.id, workspaceId: context.workspaceId, deletedAt: null },
        include: {
          lead: { select: { sourceId: true } },
          currentStage: true,
          stageHistory: { where: { exitedAt: null }, take: 1, orderBy: { enteredAt: "desc" } },
          offers: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
          meetings: { where: { status: "COMPLETED", deletedAt: null }, take: 1 },
        },
      });
      if (!opportunity) notFound("Oportunidade não encontrada.");
      await assertOriginCapability(transaction, context, originDecision, opportunity.lead.sourceId, "canTransition");
      if (opportunity.revision !== parsed.data.expectedRevision) {
        conflict("OPPORTUNITY_VERSION_CONFLICT", "A oportunidade mudou. Recarregue antes de continuar.");
      }
      if (opportunity.status !== "OPEN") {
        conflict("OPPORTUNITY_CLOSED", "Use a reabertura autorizada para alterar uma oportunidade encerrada.");
      }
      if (!isOpportunityStageCode(opportunity.currentStage.opportunityStageCode)) {
        conflict("PIPELINE_CONFIGURATION_INVALID", "A etapa atual não possui código operacional.");
      }
      const target = await transaction.pipelineStage.findFirst({
        where: {
          id: parsed.data.targetStageId,
          workspaceId: context.workspaceId,
          pipelineId: opportunity.pipelineId,
          opportunityStageCode: { not: null },
          deletedAt: null,
        },
      });
      if (!target || !isOpportunityStageCode(target.opportunityStageCode)) notFound("Etapa de destino não encontrada.");
      await assertPipelineRequiredFields(transaction, opportunity.id, target.id);
      const currentCode = opportunity.currentStage.opportunityStageCode;
      const targetCode = target.opportunityStageCode;
      await assertRequiredStageActivitiesComplete(transaction, context.workspaceId, opportunity.id);
      const gateSnapshot = await assertConsultativeSalesGates(transaction, opportunity.id, targetCode);
      const allowedTransition = await transaction.pipelineStageTransition.findFirst({
        where: {
          workspaceId: context.workspaceId,
          pipelineId: opportunity.pipelineId,
          fromStageId: opportunity.currentStageId,
          toStageId: target.id,
          active: true,
        },
        select: { id: true },
      });
      if (!allowedTransition) conflict("INVALID_OPPORTUNITY_TRANSITION", `Não é permitido mover de ${opportunity.currentStage.name} para ${target.name}.`);
      if (targetCode === "PROPOSAL") {
        conflict("PROPOSAL_FORM_REQUIRED", "Registre a proposta pelo formulário próprio.");
      }
      if (targetCode === "MEETING_HELD" && opportunity.meetings.length === 0) {
        conflict("MEETING_ATTENDANCE_REQUIRED", "Registre o comparecimento da reunião antes desta transição.");
      }
      if (opportunityStageRequiresOffer(targetCode) && opportunity.offers.length === 0) {
        conflict("PROPOSAL_REQUIRED", "Registre uma proposta antes desta transição.");
      }
      if (opportunityStageRequiresConfirmation(targetCode) && !parsed.data.confirmed) {
        conflict("CONFIRMATION_REQUIRED", "Confirme explicitamente esta transição sensível.");
      }
      let lossReason: { id: string; name: string } | null = null;
      if (targetCode === "LOST") {
        if (!parsed.data.lossReasonId) conflict("LOSS_REASON_REQUIRED", "Selecione um motivo de perda.");
        lossReason = await transaction.lossReason.findFirst({
          where: { id: parsed.data.lossReasonId, workspaceId: context.workspaceId, active: true, deletedAt: null },
          select: { id: true, name: true },
        });
        if (!lossReason) notFound("Motivo de perda não encontrado ou inativo.");
      }
      if (targetCode === "WON" && (!opportunity.productId || opportunity.amountCents <= 0n || opportunity.tcvCents <= 0n)) {
        conflict("WON_DATA_REQUIRED", "Ganho exige produto, valor e TCV positivos.");
      }
      if (parsed.data.nextAction) {
        await createOpportunityTask(transaction, {
          workspaceId: context.workspaceId,
          leadId: opportunity.leadId,
          opportunityId: opportunity.id,
          ownerMemberId: opportunity.ownerMemberId,
          actorId: context.actorId,
          title: parsed.data.nextAction.title,
          dueAt: parseWorkspaceLocalDateTime(parsed.data.nextAction.dueAtLocal, timeZone),
          now,
        });
      }
      const closing = targetCode === "WON" || targetCode === "LOST";
      const cancelledTasks = closing
        ? await transaction.task.findMany({
            where: { workspaceId: context.workspaceId, opportunityId: opportunity.id, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
            select: { id: true },
          })
        : [];
      if (cancelledTasks.length > 0) {
        await transaction.task.updateMany({
          where: { id: { in: cancelledTasks.map((task) => task.id) }, workspaceId: context.workspaceId },
          data: {
            status: "CANCELLED",
            result: targetCode === "WON" ? "Encerrada após ganho." : "Encerrada após perda.",
            updatedByActorId: context.actorId,
            updatedAt: now,
          },
        });
      }
      if (closing) await cancelIncompatibleAccountPlanActionsInTransaction(transaction, { workspaceId: context.workspaceId, opportunityId: opportunity.id, actorId: context.actorId, at: now, event: targetCode });
      const nextTask = closing ? null : await activeOpportunityTask(transaction, context.workspaceId, opportunity.id);
      if (opportunityStageRequiresNextAction(targetCode) && !nextTask) {
        conflict("NEXT_ACTION_REQUIRED", "Crie uma próxima ação antes de mover para uma etapa aberta.");
      }
      const history = opportunity.stageHistory[0];
      if (!history || history.stageId !== opportunity.currentStageId) {
        conflict("STAGE_HISTORY_INCONSISTENT", "O histórico aberto não corresponde à etapa atual.");
      }
      const effectiveAt = now > history.enteredAt ? now : new Date(history.enteredAt.getTime() + 1);
      await supersedeOpenStageActivities(transaction, context.workspaceId, opportunity.id, context.actorId, effectiveAt);
      await transaction.stageHistory.update({
        where: { id: history.id },
        data: { exitedAt: effectiveAt, exitedByActorId: context.actorId },
      });
      const enteredHistory = await transaction.stageHistory.create({
        data: {
          workspaceId: context.workspaceId,
          pipelineId: opportunity.pipelineId,
          stageId: target.id,
          opportunityId: opportunity.id,
          enteredAt: effectiveAt,
          enteredByActorId: context.actorId,
          transitionOrigin: parsed.data.origin,
          transitionReason: parsed.data.reason,
        },
        select: { id: true },
      });
      await recordGateEvaluation(transaction, { workspaceId: context.workspaceId, opportunityId: opportunity.id, stageHistoryId: enteredHistory.id, targetStageCode: targetCode, actorId: context.actorId, evaluatedAt: effectiveAt, snapshot: gateSnapshot });
      await instantiateStageActivities(transaction, { workspaceId: context.workspaceId, opportunityId: opportunity.id, leadId: opportunity.leadId, ownerMemberId: opportunity.ownerMemberId, pipelineId: opportunity.pipelineId, stageId: target.id, stageHistoryId: enteredHistory.id, actorId: context.actorId, enteredAt: effectiveAt });
      const status = opportunityStatusForStage(targetCode);
      const updated = await transaction.opportunity.update({
        where: { id: opportunity.id },
        data: {
          currentStageId: target.id,
          status,
          closedAt: closing ? effectiveAt : null,
          lossReasonId: lossReason?.id ?? null,
          outcomeReasonCode: lossReason?.name ?? (targetCode === "WON" ? parsed.data.reason : null),
          ...opportunityTaskProjection(nextTask),
          revision: { increment: 1 },
          updatedByActorId: context.actorId,
          updatedAt: effectiveAt,
        },
      });
      if (targetCode === "WON") {
        await reconcileCommissionsInTransaction(transaction, context, effectiveAt, opportunity.id);
      }
      if (targetCode === "WON" && opportunity.offers[0]) {
        await transaction.offer.update({
          where: { id: opportunity.offers[0].id },
          data: { acceptedAt: effectiveAt, updatedByActorId: context.actorId, updatedAt: effectiveAt },
        });
      }
      if (targetCode === "WON" || targetCode === "LOST") {
        await transaction.opportunityOutcomeSnapshot.create({
          data: {
            workspaceId: context.workspaceId,
            opportunityId: opportunity.id,
            leadId: opportunity.leadId,
            stageHistoryId: enteredHistory.id,
            ownerMemberId: opportunity.ownerMemberId,
            productId: opportunity.productId,
            status,
            amountCents: opportunity.amountCents,
            mrrCents: opportunity.mrrCents,
            tcvCents: opportunity.tcvCents,
            currency: opportunity.currency,
            lossReasonId: lossReason?.id ?? null,
            occurredAt: effectiveAt,
            createdByActorId: context.actorId,
            createdAt: effectiveAt,
          },
        });
      }
      const activityType = targetCode === "WON" ? "WON" : targetCode === "LOST" ? "LOST" : "STAGE_CHANGE";
      const activity = await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: opportunity.leadId,
          opportunityId: opportunity.id,
          type: activityType,
          direction: "INTERNAL",
          result: targetCode === "WON" ? "WON" : targetCode === "LOST" ? "LOST" : "INFORMATION",
          subject: targetCode === "WON" ? `Venda ganha: ${opportunity.name}` : targetCode === "LOST" ? `Oportunidade perdida: ${opportunity.name}` : `Oportunidade: ${target.name}`,
          description: parsed.data.reason,
          occurredAt: effectiveAt,
          nextActionAt: nextTask?.dueAt ?? null,
          nextActionDescription: nextTask?.title ?? null,
          previousValues: { stageId: opportunity.currentStageId, stageCode: currentCode, status: opportunity.status },
          newValues: { stageId: target.id, stageCode: targetCode, status, lossReasonId: lossReason?.id ?? null },
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: effectiveAt,
          updatedAt: effectiveAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: targetCode === "WON" ? "opportunity.won" : targetCode === "LOST" ? "opportunity.lost" : "opportunity.stage.transitioned",
          entityType: "Opportunity",
          entityId: opportunity.id,
          occurredAt: effectiveAt,
          changes: {
            fromStageCode: currentCode,
            toStageCode: targetCode,
            fromStatus: opportunity.status,
            toStatus: status,
            reason: parsed.data.reason,
            lossReasonId: lossReason?.id ?? null,
            cancelledTaskIds: cancelledTasks.map((task) => task.id),
            activityId: activity.id,
          },
          metadata: { origin: parsed.data.origin },
        },
      });
      const leadTask = await activeLeadTask(transaction, context.workspaceId, opportunity.leadId);
      await transaction.lead.update({
        where: { id: opportunity.leadId },
        data: { ...leadTaskProjection(leadTask), lastActivityAt: effectiveAt, updatedByActorId: context.actorId, updatedAt: effectiveAt },
      });
      if (closing && options.automationPublisher) {
        await publishOpportunityClosedInTransaction(
          transaction,
          options.automationPublisher,
          {
            workspaceId: context.workspaceId,
            leadId: opportunity.leadId,
            opportunityId: opportunity.id,
            status: targetCode as "WON" | "LOST",
            occurredAt: effectiveAt,
            actorId: context.actorId,
          },
        );
      }
      await options.beforeCommit?.();
      return { opportunityId: opportunity.id, revision: updated.revision, status, stageCode: targetCode };
    });
  }

  async function registerProposal(context: AuthenticatedContext, payload: unknown) {
    const parsed = proposalSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    let totalCents = parsed.data.unitPriceCents * BigInt(parsed.data.quantity) - parsed.data.discountCents;
    if (totalCents < 0n) invalidInput("O desconto não pode superar o valor bruto.");
    if (totalCents === 0n && !parsed.data.justification) invalidInput("Proposta sem valor exige justificativa.");
    if (!parsed.data.confirmed) conflict("CONFIRMATION_REQUIRED", "Confirme explicitamente o registro da proposta.");
    const authRow = await options.database.opportunity.findFirst({
      where: { id: parsed.data.opportunityId, workspaceId: context.workspaceId, deletedAt: null },
      select: { id: true, ownerMemberId: true },
    });
    if (!authRow) notFound("Oportunidade não encontrada.");
    await options.authorization.assertAuthorized(context, PermissionKeys.OPPORTUNITIES_WRITE, opportunityResource(context.workspaceId, authRow));
    const timeZone = await getWorkspaceTimeZone(options.database, context.workspaceId);
    const now = options.now();
    return options.database.$transaction(async (transaction) => {
      await lockOpportunity(transaction, context.workspaceId, authRow.id);
      const opportunity = await transaction.opportunity.findFirst({
        where: { id: authRow.id, workspaceId: context.workspaceId, status: "OPEN", deletedAt: null },
        include: {
          currentStage: true,
          stageHistory: { where: { exitedAt: null }, take: 1, orderBy: { enteredAt: "desc" } },
        },
      });
      if (!opportunity) notFound("Oportunidade aberta não encontrada.");
      if (opportunity.revision !== parsed.data.expectedRevision) conflict("OPPORTUNITY_VERSION_CONFLICT", "A oportunidade mudou. Recarregue antes de continuar.");
      if (opportunity.currentStage.opportunityStageCode !== "OPPORTUNITY_CONFIRMED" && opportunity.currentStage.opportunityStageCode !== "PROPOSAL") {
        conflict("PROPOSAL_STAGE_REQUIRED", "Confirme a oportunidade antes de registrar proposta.");
      }
      const [product, template, proposalStage] = await Promise.all([
        transaction.product.findFirst({
          where: { id: parsed.data.productId, workspaceId: context.workspaceId, active: true, deletedAt: null },
        }),
        parsed.data.offerTemplateId
          ? transaction.offerTemplate.findFirst({
              where: { id: parsed.data.offerTemplateId, workspaceId: context.workspaceId, productId: parsed.data.productId, active: true, deletedAt: null },
              include: { components: { orderBy: { position: "asc" }, include: { product: true } } },
            })
          : Promise.resolve(null),
        transaction.pipelineStage.findFirst({
          where: { workspaceId: context.workspaceId, pipelineId: opportunity.pipelineId, opportunityStageCode: "PROPOSAL", deletedAt: null },
        }),
      ]);
      if (!product) notFound("Produto não encontrado ou inativo.");
      if (!isCatalogItemSellable(product, now)) conflict("CATALOG_ITEM_NOT_SELLABLE", "A versão do catálogo não está aprovada para venda.");
      if (parsed.data.offerTemplateId && !template) notFound("Oferta/plano não pertence ao produto selecionado.");
      if (template && template.components.some((component) => !isCatalogItemSellable(component.product, now))) conflict("CATALOG_COMPONENT_NOT_SELLABLE", "A oferta contém componente indisponível, futuro ou sem capacidade.");
      if (!proposalStage) conflict("PIPELINE_CONFIGURATION_INVALID", "Etapa Proposta não encontrada.");
      if (parsed.data.nextAction) {
        await createOpportunityTask(transaction, {
          workspaceId: context.workspaceId,
          leadId: opportunity.leadId,
          opportunityId: opportunity.id,
          ownerMemberId: opportunity.ownerMemberId,
          actorId: context.actorId,
          title: parsed.data.nextAction.title,
          dueAt: parseWorkspaceLocalDateTime(parsed.data.nextAction.dueAtLocal, timeZone),
          now,
        });
      }
      const nextTask = await activeOpportunityTask(transaction, context.workspaceId, opportunity.id);
      if (!nextTask) conflict("NEXT_ACTION_REQUIRED", "A proposta exige uma próxima ação aberta.");
      const validUntil = parsed.data.validUntilDate
        ? parseWorkspaceLocalDateTime(`${parsed.data.validUntilDate}T23:59`, timeZone)
        : null;
      const proposalLines = template?.components.length
        ? template.components.map((component) => ({ product: component.product, quantity: component.quantity, unitPriceCents: component.unitPriceCents, discountCents: component.discountCents }))
        : [{ product, quantity: parsed.data.quantity, unitPriceCents: parsed.data.unitPriceCents, discountCents: parsed.data.discountCents }];
      totalCents = proposalLines.reduce((sum, line) => sum + line.unitPriceCents * BigInt(line.quantity) - line.discountCents, 0n);
      if (totalCents < 0n) invalidInput("A composição da proposta possui total inválido.");
      const offer = await transaction.offer.create({
        data: {
          workspaceId: context.workspaceId,
          opportunityId: opportunity.id,
          productId: product.id,
          offerTemplateId: template?.id ?? null,
          name: parsed.data.name,
          quantity: parsed.data.quantity,
          unitPriceCents: parsed.data.unitPriceCents,
          discountCents: parsed.data.discountCents,
          totalCents,
          justification: parsed.data.justification ?? null,
          validUntil,
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: now,
          updatedAt: now,
        },
      });
      await transaction.offerLine.createMany({ data: proposalLines.map((line, position) => ({ workspaceId: context.workspaceId, offerId: offer.id, productId: line.product.id, position: position + 1, productVersionSnapshot: line.product.version, productSkuSnapshot: line.product.sku, productNameSnapshot: line.product.name, productKindSnapshot: line.product.kind, revenueCategorySnapshot: line.product.revenueCategory, approvedConditionsSnapshot: line.product.approvedConditions, quantity: line.quantity, unitPriceCents: line.unitPriceCents, discountCents: line.discountCents, totalCents: line.unitPriceCents * BigInt(line.quantity) - line.discountCents })) });
      const history = opportunity.stageHistory[0];
      if (!history || history.stageId !== opportunity.currentStageId) conflict("STAGE_HISTORY_INCONSISTENT", "O histórico aberto não corresponde à etapa atual.");
      const changesStage = opportunity.currentStage.opportunityStageCode === "OPPORTUNITY_CONFIRMED";
      await assertRequiredStageActivitiesComplete(transaction, context.workspaceId, opportunity.id);
      const gateSnapshot = await assertConsultativeSalesGates(transaction, opportunity.id, "PROPOSAL", product.id);
      if (changesStage) {
        const configuredTransition = await transaction.pipelineStageTransition.findFirst({
          where: {
            workspaceId: context.workspaceId,
            pipelineId: opportunity.pipelineId,
            fromStageId: opportunity.currentStageId,
            toStageId: proposalStage.id,
            active: true,
          },
          select: { id: true },
        });
        if (!configuredTransition) conflict("INVALID_OPPORTUNITY_TRANSITION", "A transição para proposta está desativada nas configurações.");
      }
      const effectiveAt = now > history.enteredAt ? now : new Date(history.enteredAt.getTime() + 1);
      if (changesStage) {
        await supersedeOpenStageActivities(transaction, context.workspaceId, opportunity.id, context.actorId, effectiveAt);
        await transaction.stageHistory.update({ where: { id: history.id }, data: { exitedAt: effectiveAt, exitedByActorId: context.actorId } });
        const enteredHistory = await transaction.stageHistory.create({
          data: {
            workspaceId: context.workspaceId,
            pipelineId: opportunity.pipelineId,
            stageId: proposalStage.id,
            opportunityId: opportunity.id,
            enteredAt: effectiveAt,
            enteredByActorId: context.actorId,
            transitionOrigin: "OPPORTUNITY_CARD",
            transitionReason: `Proposta ${offer.id} registrada.`,
          },
        });
        await recordGateEvaluation(transaction, { workspaceId: context.workspaceId, opportunityId: opportunity.id, stageHistoryId: enteredHistory.id, targetStageCode: "PROPOSAL", actorId: context.actorId, evaluatedAt: effectiveAt, snapshot: gateSnapshot });
        await instantiateStageActivities(transaction, { workspaceId: context.workspaceId, opportunityId: opportunity.id, leadId: opportunity.leadId, ownerMemberId: opportunity.ownerMemberId, pipelineId: opportunity.pipelineId, stageId: proposalStage.id, stageHistoryId: enteredHistory.id, actorId: context.actorId, enteredAt: effectiveAt });
      }
      const updated = await transaction.opportunity.update({
        where: { id: opportunity.id },
        data: {
          currentStageId: changesStage ? proposalStage.id : opportunity.currentStageId,
          productId: product.id,
          amountCents: totalCents,
          tcvCents: totalCents,
          ...opportunityTaskProjection(nextTask),
          revision: { increment: 1 },
          updatedByActorId: context.actorId,
          updatedAt: effectiveAt,
        },
      });
      const activity = await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: opportunity.leadId,
          opportunityId: opportunity.id,
          type: "PROPOSAL",
          direction: "OUTBOUND",
          result: "SENT",
          subject: `Proposta registrada: ${offer.name}`,
          description: parsed.data.justification ?? null,
          occurredAt: effectiveAt,
          nextActionAt: nextTask.dueAt,
          nextActionDescription: nextTask.title,
          previousValues: { stageCode: opportunity.currentStage.opportunityStageCode },
          newValues: { stageCode: "PROPOSAL", offerId: offer.id, productId: product.id, totalCents: totalCents.toString() },
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: effectiveAt,
          updatedAt: effectiveAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "opportunity.proposal.registered",
          entityType: "Opportunity",
          entityId: opportunity.id,
          occurredAt: effectiveAt,
          changes: { offerId: offer.id, productId: product.id, totalCents: totalCents.toString(), activityId: activity.id, stageCode: "PROPOSAL" },
          metadata: { origin: "OPPORTUNITY_CARD" },
        },
      });
      const leadTask = await activeLeadTask(transaction, context.workspaceId, opportunity.leadId);
      await transaction.lead.update({
        where: { id: opportunity.leadId },
        data: { ...leadTaskProjection(leadTask), lastActivityAt: effectiveAt, updatedByActorId: context.actorId, updatedAt: effectiveAt },
      });
      await options.beforeCommit?.();
      return { opportunityId: opportunity.id, offerId: offer.id, revision: updated.revision, totalCents: totalCents.toString() };
    });
  }

  async function reopen(context: AuthenticatedContext, payload: unknown) {
    const parsed = reopenSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const authRow = await options.database.opportunity.findFirst({
      where: { id: parsed.data.opportunityId, workspaceId: context.workspaceId, deletedAt: null },
      select: { id: true, ownerMemberId: true },
    });
    if (!authRow) notFound("Oportunidade não encontrada.");
    const resource = opportunityResource(context.workspaceId, authRow);
    await options.authorization.assertAuthorized(context, PermissionKeys.OPPORTUNITIES_WRITE, resource);
    await options.authorization.assertAuthorized(context, PermissionKeys.LEADS_ASSIGN, resource);
    const timeZone = await getWorkspaceTimeZone(options.database, context.workspaceId);
    const now = options.now();
    return options.database.$transaction(async (transaction) => {
      await lockOpportunity(transaction, context.workspaceId, authRow.id);
      const opportunity = await transaction.opportunity.findFirst({
        where: { id: authRow.id, workspaceId: context.workspaceId, deletedAt: null },
        include: {
          currentStage: true,
          stageHistory: { where: { exitedAt: null }, take: 1, orderBy: { enteredAt: "desc" } },
          offers: { where: { deletedAt: null }, take: 1 },
        },
      });
      if (!opportunity || (opportunity.status !== "WON" && opportunity.status !== "LOST")) conflict("OPPORTUNITY_NOT_CLOSED", "Somente oportunidades encerradas podem ser reabertas.");
      if (opportunity.revision !== parsed.data.expectedRevision) conflict("OPPORTUNITY_VERSION_CONFLICT", "A oportunidade mudou. Recarregue antes de continuar.");
      if (opportunity.offers.length === 0) conflict("PROPOSAL_REQUIRED", "A reabertura em negociação exige proposta registrada.");
      const target = await transaction.pipelineStage.findFirst({
        where: { workspaceId: context.workspaceId, pipelineId: opportunity.pipelineId, opportunityStageCode: "NEGOTIATION", deletedAt: null },
      });
      const history = opportunity.stageHistory[0];
      if (!target || !history || history.stageId !== opportunity.currentStageId) conflict("STAGE_HISTORY_INCONSISTENT", "O histórico da oportunidade está inconsistente.");
      const task = await createOpportunityTask(transaction, {
        workspaceId: context.workspaceId,
        leadId: opportunity.leadId,
        opportunityId: opportunity.id,
        ownerMemberId: opportunity.ownerMemberId,
        actorId: context.actorId,
        title: parsed.data.nextAction.title,
        dueAt: parseWorkspaceLocalDateTime(parsed.data.nextAction.dueAtLocal, timeZone),
        now,
      });
      const effectiveAt = now > history.enteredAt ? now : new Date(history.enteredAt.getTime() + 1);
      const gateSnapshot = await assertConsultativeSalesGates(transaction, opportunity.id, "NEGOTIATION");
      await supersedeOpenStageActivities(transaction, context.workspaceId, opportunity.id, context.actorId, effectiveAt);
      await transaction.stageHistory.update({ where: { id: history.id }, data: { exitedAt: effectiveAt, exitedByActorId: context.actorId } });
      const enteredHistory = await transaction.stageHistory.create({
        data: {
          workspaceId: context.workspaceId,
          pipelineId: opportunity.pipelineId,
          stageId: target.id,
          opportunityId: opportunity.id,
          enteredAt: effectiveAt,
          enteredByActorId: context.actorId,
          transitionOrigin: "OPPORTUNITY_CARD",
          transitionReason: parsed.data.reason,
          managerCorrection: true,
        },
      });
      await recordGateEvaluation(transaction, { workspaceId: context.workspaceId, opportunityId: opportunity.id, stageHistoryId: enteredHistory.id, targetStageCode: "NEGOTIATION", actorId: context.actorId, evaluatedAt: effectiveAt, snapshot: gateSnapshot });
      await instantiateStageActivities(transaction, { workspaceId: context.workspaceId, opportunityId: opportunity.id, leadId: opportunity.leadId, ownerMemberId: opportunity.ownerMemberId, pipelineId: opportunity.pipelineId, stageId: target.id, stageHistoryId: enteredHistory.id, actorId: context.actorId, enteredAt: effectiveAt });
      const updated = await transaction.opportunity.update({
        where: { id: opportunity.id },
        data: {
          currentStageId: target.id,
          status: "OPEN",
          closedAt: null,
          lossReasonId: null,
          outcomeReasonCode: null,
          ...opportunityTaskProjection(task),
          revision: { increment: 1 },
          updatedByActorId: context.actorId,
          updatedAt: effectiveAt,
        },
      });
      const activity = await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: opportunity.leadId,
          opportunityId: opportunity.id,
          type: "STAGE_CHANGE",
          direction: "INTERNAL",
          result: "INFORMATION",
          subject: `Oportunidade reaberta: ${opportunity.name}`,
          description: parsed.data.reason,
          occurredAt: effectiveAt,
          nextActionAt: task.dueAt,
          nextActionDescription: task.title,
          previousValues: { stageCode: opportunity.currentStage.opportunityStageCode, status: opportunity.status },
          newValues: { stageCode: "NEGOTIATION", status: "OPEN" },
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: effectiveAt,
          updatedAt: effectiveAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "opportunity.reopened",
          entityType: "Opportunity",
          entityId: opportunity.id,
          occurredAt: effectiveAt,
          changes: { from: opportunity.currentStage.opportunityStageCode, to: "NEGOTIATION", reason: parsed.data.reason, taskId: task.id, activityId: activity.id },
          metadata: { managerCorrection: true },
        },
      });
      const leadTask = await activeLeadTask(transaction, context.workspaceId, opportunity.leadId);
      await transaction.lead.update({
        where: { id: opportunity.leadId },
        data: { ...leadTaskProjection(leadTask), lastActivityAt: effectiveAt, updatedByActorId: context.actorId, updatedAt: effectiveAt },
      });
      await options.beforeCommit?.();
      return { opportunityId: opportunity.id, revision: updated.revision, stageCode: "NEGOTIATION" as const };
    });
  }

  return Object.freeze({ getPipelineScreen, getLeadScreen, create, transition, registerProposal, reopen });
}

let service: ReturnType<typeof createOpportunityService> | undefined;

export function getOpportunityService() {
  service ??= createOpportunityService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
    automationPublisher: getAutomationEngineService(),
  });
  return service;
}
