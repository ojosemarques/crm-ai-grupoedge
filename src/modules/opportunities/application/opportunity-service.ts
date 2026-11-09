import type {
  PermissionScope,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { reconcileCommissionsInTransaction } from "@/modules/finance/application/finance-service";
import { reconcileCloserCompensation } from "@/modules/finance/application/closer-compensation-reconciliation";
import { invoiceUpfrontAmounts } from "@/modules/payments/application/invoice-upfront";
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
import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { syncActiveProspectingCommercialStageInTransaction } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import {
  parseWorkspaceLocalDateTime,
  workspaceDateAt,
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
  pipelineId: z.union([z.literal(""), z.string().uuid()]).default(""),
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

async function getOpportunityPipeline(database: PrismaClient | Prisma.TransactionClient, workspaceId: string, pipelineId = "") {
  const pipeline = await database.pipeline.findFirst({
    where: {
      workspaceId,
      entityType: "OPPORTUNITY",
      deletedAt: null,
      ...(pipelineId ? { id: pipelineId } : { isDefault: true }),
    },
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
  if (!pipeline) notFound(pipelineId ? "Pipeline de vendas não encontrado." : "Pipeline padrão de vendas não encontrado.");
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

export async function assertOriginCapability(
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
        ...commercialMemberWhere({
          workspaceId: context.workspaceId,
          functions: ["CLOSER"],
          ...(scope === "OWN" ? { memberId: context.memberId } : {}),
        }),
        ...(scope === "TEAM" ? { id: { in: [...ownerIds] } } : {}),
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

async function saleSellerOptions(
  database: PrismaClient,
  context: AuthenticatedContext,
  scope: PermissionScope,
  ownerIds: readonly string[],
) {
  const sellers = await database.workspaceMember.findMany({
    where: {
      ...commercialMemberWhere({
        workspaceId: context.workspaceId,
        functions: ["SDR", "CLOSER"],
        ...(scope === "OWN" ? { memberId: context.memberId } : {}),
      }),
      ...(scope === "TEAM" ? { id: { in: [...ownerIds] } } : {}),
    },
    orderBy: { user: { displayName: "asc" } },
    select: { id: true, user: { select: { displayName: true } } },
  });
  return sellers.map((seller) => ({ id: seller.id, name: seller.user.displayName }));
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
  async function customerSaleScope(context: AuthenticatedContext): Promise<Prisma.OpportunityWhereInput[]> {
    const accountResource = { workspaceId: context.workspaceId, resourceType: "Account", ownerMemberId: context.memberId };
    const accountScope = await options.authorization.authorize(context, PermissionKeys.ACCOUNTS_READ, accountResource);
    if (!accountScope.allowed) {
      await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_READ, accountResource);
      throw new Error("Unreachable authorization branch");
    }
    const opportunityScope = await resolveScope(options.database, options.authorization, context, PermissionKeys.OPPORTUNITIES_READ);
    const visibility = await originVisibility(options.database, context, opportunityScope.scope);
    const accountOwners = accountScope.scope === "TEAM"
      ? opportunityScope.scope === "TEAM" ? opportunityScope.ownerIds : await teamOwnerIds(options.database, context)
      : [];
    return [
      scopeWhere(opportunityScope.scope, context, opportunityScope.ownerIds),
      scopeWhere(accountScope.scope, context, accountOwners),
      originVisibilityWhere(opportunityScope.scope, visibility),
    ];
  }

  async function readCustomerSale(database: PrismaClient | Prisma.TransactionClient, context: AuthenticatedContext, accountId: string, opportunityId: string) {
    const row = await database.opportunity.findFirst({
      where: {
        id: opportunityId, workspaceId: context.workspaceId, accountId, status: "WON",
        closedAt: { not: null }, deletedAt: null, account: { deletedAt: null }, lead: { deletedAt: null },
        AND: await customerSaleScope(context),
      },
      include: {
        account: { select: { name: true } },
        owner: { select: { user: { select: { displayName: true } } } },
        lead: { select: { sourceId: true, queue: { select: { teamId: true } }, routingQueue: { select: { teamId: true } } } },
        commercialContract: { select: { id: true, currentVersionId: true, ownerMemberId: true, status: true, revision: true } },
        saleConfirmations: {
          take: 1, orderBy: { revision: "desc" },
          include: { seller: { select: { user: { select: { displayName: true } } } } },
        },
      },
    });
    if (!row) notFound("Venda ganha não encontrada nesta conta.");
    const resource = opportunityResource(context.workspaceId, row);
    await options.authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_READ, { ...resource, resourceType: "Account", resourceId: accountId });
    return { row, resource };
  }

  async function getCustomerSale(context: AuthenticatedContext, accountId: string, opportunityId: string) {
    const { row, resource } = await readCustomerSale(options.database, context, accountId, opportunityId);
    const contract = row.commercialContract;
    const contractResource = contract
      ? { ...resource, resourceType: "CommercialContract", resourceId: contract.id, ownerMemberId: contract.ownerMemberId }
      : null;
    const [access, read, assign, finance, timeZone] = await Promise.all([
      contractResource ? options.authorization.authorize(context, PermissionKeys.CONTRACTS_ACCEPT_RECORD, contractResource) : { allowed: false },
      contractResource ? options.authorization.authorize(context, PermissionKeys.CONTRACTS_READ, contractResource) : { allowed: false },
      options.authorization.authorize(context, PermissionKeys.OWNERSHIP_ASSIGN, resource),
      options.authorization.authorize(context, PermissionKeys.FINANCE_MANAGE, { workspaceId: context.workspaceId, resourceType: "Finance", resourceId: context.workspaceId }),
      getWorkspaceTimeZone(options.database, context.workspaceId),
    ]);
    const [version, invoices] = await Promise.all([
      (read.allowed || access.allowed) && contract?.currentVersionId ? options.database.contractVersion.findFirst({
        where: { id: contract.currentVersionId, workspaceId: context.workspaceId, contractId: contract.id },
        select: { totalCents: true, paymentTerms: true },
      }) : null,
      contract ? options.database.invoice.findMany({
        where: { workspaceId: context.workspaceId, accountId, contractId: contract.id, status: { notIn: ["VOIDED", "CANCELLED"] } },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        select: { id: true, ownerMemberId: true, invoiceNumber: true, dueAt: true, totalCents: true, paidCents: true, status: true, revision: true, revisedUpfrontCents: true },
      }) : [],
    ]);
    const scheduleUpfront = read.allowed || access.allowed
      ? [...(await invoiceUpfrontAmounts(options.database, context.workspaceId, invoices)).values()].reduce((sum, amount) => sum + amount, 0n).toString()
      : null;
    const latest = row.saleConfirmations[0];
    const canAmend = !latest && finance.allowed && access.allowed && contract?.status === "ACCEPTED" && contractResource
      ? (await Promise.all([PermissionKeys.CONTRACTS_VERSION_CREATE, PermissionKeys.CONTRACTS_DRAFT_WRITE, PermissionKeys.CONTRACTS_ISSUE]
        .map((permission) => options.authorization.authorize(context, permission, contractResource)))).every((decision) => decision.allowed)
      : false;
    const now = options.now();
    const today = workspaceDayRange(workspaceDateAt(now, timeZone), timeZone).start;
    const installments = (await Promise.all(invoices.map(async (invoice) => {
      const invoiceResource = {
        workspaceId: context.workspaceId, resourceType: "Payment", resourceId: invoice.id, ownerMemberId: invoice.ownerMemberId,
      };
      const canRead = await options.authorization.authorize(context, PermissionKeys.PAYMENTS_READ, invoiceResource);
      if (!canRead.allowed && !read.allowed && !access.allowed) return null;
      const canReallocate = finance.allowed && canRead.allowed && invoice.paidCents === 0n
        && ["DRAFT", "OPEN"].includes(invoice.status) && (invoice.dueAt > now || (canAmend && invoice.dueAt >= today))
        && (await options.authorization.authorize(context, PermissionKeys.PAYMENTS_MANAGE, invoiceResource)).allowed;
      return {
        id: invoice.id, number: invoice.invoiceNumber, dueAt: invoice.dueAt.toISOString(),
        totalCents: invoice.totalCents.toString(), paidCents: canRead.allowed ? invoice.paidCents.toString() : null,
        status: canRead.allowed ? invoice.status : null, canRead: canRead.allowed, canReallocate,
        priceOnly: invoice.dueAt <= now, revision: invoice.revision,
      };
    }))).filter((invoice) => invoice !== null);
    const sellers = access.allowed && assign.allowed ? await options.database.workspaceMember.findMany({
      where: commercialMemberWhere({ workspaceId: context.workspaceId, functions: ["SDR", "CLOSER"] }),
      orderBy: { user: { displayName: "asc" } }, select: { id: true, user: { select: { displayName: true } } },
    }) : [];
    const currentSeller = latest
      ? { id: latest.sellerMemberId, name: latest.seller.user.displayName }
      : { id: row.ownerMemberId, name: row.owner.user.displayName };
    const sellerOptions = [currentSeller,
      ...sellers.filter((seller) => seller.id !== currentSeller.id).map((seller) => ({ id: seller.id, name: seller.user.displayName }))];
    return {
      id: row.id, name: row.name, accountName: row.account!.name, sellerName: row.owner.user.displayName,
      sellerMemberId: currentSeller.id, timeZone, sellerOptions,
      canConfirm: access.allowed && version !== null && version.totalCents > 0n && !["REJECTED", "VOIDED", "SUPERSEDED", "EXPIRED"].includes(contract!.status),
      terms: version?.paymentTerms ?? null,
      netContractCents: version?.totalCents.toString() ?? null, installments,
      scheduleUpfrontCents: invoices.length ? scheduleUpfront : null,
      amendment: canAmend && version && contract ? {
        revision: contract.revision, totalCents: version.totalCents.toString(), paymentTerms: version.paymentTerms,
        upfrontCents: scheduleUpfront ?? "0",
      } : null,
      confirmation: latest ? {
        revision: latest.revision, modality: latest.modality, upfrontCents: latest.upfrontCents.toString(),
        acceptedAt: latest.acceptedAt.toISOString(), activationAt: latest.activationAt?.toISOString() ?? null,
        confirmedAt: latest.confirmedAt.toISOString(), sourceEvidence: access.allowed ? latest.sourceEvidence : "",
        confirmationReason: access.allowed ? latest.confirmationReason : "", selfSourced: latest.selfSourced,
      } : null,
    };
  }

  async function confirmCustomerSale(context: AuthenticatedContext, accountId: string, opportunityId: string, raw: unknown) {
    const input = z.object({
      expectedRevision: z.number().int().min(0).max(2_147_483_646),
      idempotencyKey: z.string().uuid(),
      sellerMemberId: z.string().uuid(),
      modality: z.enum(["ANNUAL_PREPAID", "ANNUAL_INSTALLMENTS", "PROJECT", "EXPANSION", "NEGOTIATED_RENEWAL", "AUTOMATIC_RENEWAL", "AUTOMATIC_LOW_TICKET"]),
      netContractCents: z.string().regex(/^[1-9]\d{0,15}$/).transform(BigInt),
      upfrontCents: z.string().regex(/^(0|[1-9]\d{0,15})$/).transform(BigInt),
      selfSourced: z.boolean(), sourceEvidence: z.string().trim().min(3).max(1000),
      acceptedAtLocal: z.string().max(16), activationAtLocal: z.string().max(16).nullable(),
      confirmationReason: z.string().trim().min(3).max(1000),
    }).strict().parse(raw);
    const timeZone = await getWorkspaceTimeZone(options.database, context.workspaceId);
    const acceptedAt = parseWorkspaceLocalDateTime(input.acceptedAtLocal, timeZone);
    const activationAt = input.activationAtLocal ? parseWorkspaceLocalDateTime(input.activationAtLocal, timeZone) : null;
    const { expectedRevision } = input;
    const terms = {
      idempotencyKey: input.idempotencyKey, sellerMemberId: input.sellerMemberId, modality: input.modality,
      netContractCents: input.netContractCents, upfrontCents: input.upfrontCents, selfSourced: input.selfSourced,
      sourceEvidence: input.sourceEvidence, confirmationReason: input.confirmationReason,
    };
    const now = options.now();
    if (acceptedAt > now || (activationAt && activationAt > now) || input.upfrontCents > input.netContractCents) {
      invalidInput("Revise as datas efetivas e o valor de entrada.");
    }
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`commercial-confirmation:${context.workspaceId}:${input.idempotencyKey}`}, 0))`;
      await lockOpportunity(tx, context.workspaceId, opportunityId);
      const { row, resource } = await readCustomerSale(tx, context, accountId, opportunityId);
      const [contract] = await tx.$queryRaw<Array<{ id: string; currentVersionId: string | null; ownerMemberId: string; status: string }>>`
        SELECT id, "currentVersionId", "ownerMemberId", status FROM commercial_contracts
        WHERE "workspaceId" = ${context.workspaceId}::uuid AND "opportunityId" = ${row.id}::uuid FOR SHARE
      `;
      if (!contract) conflict("CUSTOMER_CONTRACT_MISSING", "A venda não possui contrato comercial.");
      const contractResource = { ...resource, resourceType: "CommercialContract", resourceId: contract.id, ownerMemberId: contract.ownerMemberId };
      const decision = await options.authorization.authorize(context, PermissionKeys.CONTRACTS_ACCEPT_RECORD, contractResource);
      await options.authorization.assertAuthorized(context, PermissionKeys.CONTRACTS_ACCEPT_RECORD, contractResource);
      await assertOriginCapability(tx, context, decision, row.lead.sourceId, "canTransition");
      const replay = await tx.commercialSaleConfirmation.findUnique({
        where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } },
      });
      if (replay) {
        if (replay.opportunityId !== row.id || replay.confirmedByActorId !== context.actorId
          || replay.revision !== expectedRevision + 1
          || Object.entries(terms).some(([key, value]) => replay[key as keyof typeof terms] !== value)
          || replay.acceptedAt.getTime() !== acceptedAt.getTime() || replay.activationAt?.getTime() !== activationAt?.getTime()) {
          conflict("CUSTOMER_CONFIRMATION_KEY_CONFLICT", "A chave de confirmação já foi utilizada com outros dados.");
        }
        return { revision: replay.revision, replayed: true };
      }
      if ((row.saleConfirmations[0]?.revision ?? 0) !== expectedRevision) {
        conflict("CUSTOMER_CONFIRMATION_STALE", "A confirmação mudou. Recarregue a venda antes de salvar.");
      }
      const attributedSellerId = row.saleConfirmations[0]?.sellerMemberId ?? row.ownerMemberId;
      if (input.sellerMemberId !== attributedSellerId) {
        await options.authorization.assertAuthorized(context, PermissionKeys.OWNERSHIP_ASSIGN, resource);
      }
      if (["REJECTED", "VOIDED", "SUPERSEDED", "EXPIRED"].includes(contract.status)) {
        conflict("CUSTOMER_CONTRACT_INACTIVE", "O contrato comercial não está vigente para confirmação.");
      }
      const version = contract.currentVersionId && await tx.contractVersion.findFirst({
        where: { workspaceId: context.workspaceId, contractId: contract.id, id: contract.currentVersionId },
        select: { totalCents: true },
      });
      if (!version || version.totalCents !== input.netContractCents) {
        conflict("CUSTOMER_CONTRACT_TERMS_MISMATCH", "O valor informado precisa corresponder ao contrato comercial vigente.");
      }
      const invoices = await tx.invoice.findMany({
        where: { workspaceId: context.workspaceId, accountId, contractId: contract.id, status: { notIn: ["VOIDED", "CANCELLED"] } },
        select: { id: true, revisedUpfrontCents: true },
      });
      if (invoices.length) {
        const upfront = await invoiceUpfrontAmounts(tx, context.workspaceId, invoices);
        if ([...upfront.values()].reduce((sum, amount) => sum + amount, 0n) !== input.upfrontCents) {
          conflict("CUSTOMER_CONTRACT_UPFRONT_MISMATCH", "Revise a entrada no cronograma contratual antes de confirmar a venda.");
        }
      }
      if (input.sellerMemberId !== attributedSellerId) {
        const seller = await tx.workspaceMember.findFirst({
          where: commercialMemberWhere({ workspaceId: context.workspaceId, functions: ["SDR", "CLOSER"], memberId: input.sellerMemberId }),
          select: { id: true },
        });
        if (!seller) notFound("Vendedor ativo não encontrado neste workspace.");
      }
      const revision = expectedRevision + 1;
      await tx.commercialSaleConfirmation.create({ data: {
        ...terms, workspaceId: context.workspaceId, opportunityId: row.id, revision,
        acceptedAt, activationAt, confirmedAt: now, confirmedByActorId: context.actorId,
      } });
      await tx.auditLog.create({ data: {
        workspaceId: context.workspaceId, actorId: context.actorId, origin: "DOMAIN",
        action: "sale.customer.confirmed", entityType: "Opportunity", entityId: row.id,
        changes: { revision, previousRevision: expectedRevision, sellerMemberId: input.sellerMemberId },
      } });
      await reconcileCloserCompensation(tx, context.workspaceId, now);
      return { revision, replayed: false };
    });
  }

  async function listCustomerSales(context: AuthenticatedContext, payload: unknown) {
    const query = z.object({
      search: z.string().trim().max(200).default(""),
      status: z.enum(["ALL", "TO_CONFIRM", "AWAITING_RECEIPT", "CONFIRMED"]).default("ALL"),
      page: z.coerce.number().int().min(1).max(10_000).default(1),
    }).parse(payload);
    const receiptWhere: Prisma.PaymentWhereInput = {
      status: "CONFIRMED", reversedAt: null, amountCents: { gt: 0n },
      providerKey: { not: "LOCAL_PAYMENT_SANDBOX" }, occurredAt: { lte: options.now() },
    };
    const hasReceipt: Prisma.OpportunityWhereInput = {
      commercialContract: { invoices: { some: { payments: { some: receiptWhere } } } },
    };
    const filters: Record<typeof query.status, Prisma.OpportunityWhereInput> = {
      ALL: {},
      TO_CONFIRM: { saleConfirmations: { none: {} } },
      AWAITING_RECEIPT: { saleConfirmations: { some: {} }, NOT: hasReceipt },
      CONFIRMED: { saleConfirmations: { some: {} }, ...hasReceipt },
    };
    const where: Prisma.OpportunityWhereInput = {
      workspaceId: context.workspaceId, status: "WON", closedAt: { not: null }, accountId: { not: null }, deletedAt: null,
      lead: { deletedAt: null },
      account: { deletedAt: null },
      AND: [
        ...await customerSaleScope(context),
        filters[query.status],
        ...(query.search ? [{ OR: [
          { name: { contains: query.search, mode: "insensitive" as const } },
          { account: { name: { contains: query.search, mode: "insensitive" as const } } },
          { account: { legalName: { contains: query.search, mode: "insensitive" as const } } },
        ] }] : []),
      ],
    };
    const pageSize = 25;
    const [rows, total] = await options.database.$transaction([
      options.database.opportunity.findMany({
        where, orderBy: [{ closedAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * pageSize, take: pageSize,
        select: {
          id: true, name: true, closedAt: true,
          account: { select: { id: true, name: true } },
          owner: { select: { user: { select: { displayName: true } } } },
          saleConfirmations: {
            orderBy: { revision: "desc" }, take: 1,
            select: { seller: { select: { user: { select: { displayName: true } } } } },
          },
          commercialContract: {
            select: { invoices: { where: { payments: { some: receiptWhere } }, take: 1, select: { id: true } } },
          },
        },
      }),
      options.database.opportunity.count({ where }),
    ], { isolationLevel: "RepeatableRead" });
    return {
      total, page: query.page, pageSize,
      items: rows.map((row) => ({
        id: row.id, name: row.name, account: row.account!, closedAt: row.closedAt!.toISOString(),
        sellerName: row.saleConfirmations[0]?.seller.user.displayName ?? row.owner.user.displayName,
        status: row.saleConfirmations.length === 0 ? "TO_CONFIRM" as const
          : row.commercialContract?.invoices.length ? "CONFIRMED" as const : "AWAITING_RECEIPT" as const,
      })),
    };
  }

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
      getOpportunityPipeline(options.database, context.workspaceId, parsed.data.pipelineId),
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
      pipelineId: pipeline.id,
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
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
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
        canPrepareSale: false,
        accountOptions: [],
        suggestedAccountId: lead.accountId,
        closerOptions: [],
        saleSellerOptions: [],
        suggestedSaleSellerId: null,
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
    const [refs, saleSellers, products, templates, meetings, accounts] = await Promise.all([
      referenceOptions(options.database, context, readScope.scope, readScope.ownerIds),
      saleSellerOptions(options.database, context, readScope.scope, readScope.ownerIds),
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
      canPrepareSale: createDecision.allowed && products.length > 0 && saleSellers.length > 0,
      accountOptions: accounts,
      suggestedAccountId: lead.accountId,
      closerOptions: refs.closerOptions,
      saleSellerOptions: saleSellers,
      suggestedSaleSellerId: saleSellers.some((seller) => seller.id === lead.ownerMemberId)
        ? lead.ownerMemberId
        : saleSellers[0]?.id ?? null,
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
      await recordCommercialMetricFactInTransaction(transaction, {
        workspaceId: context.workspaceId,
        eventKey: `opportunity:${opportunity.id}:created:v1`,
        eventType: "OPPORTUNITY_CREATED",
        occurredAt: now,
        sourceEntityType: "Opportunity",
        sourceEntityId: opportunity.id,
        leadId: lead.id,
        activityId: activity.id,
        meetingId: meeting.id,
        opportunityId: opportunity.id,
        pipelineId: pipeline.id,
        stageId: initialStage.id,
        creditedMemberId: closer.id,
        performedByMemberId: context.memberId,
        leadOwnerMemberIdAtEvent: lead.ownerMemberId,
        opportunityOwnerMemberIdAtEvent: closer.id,
        valueCents: opportunity.amountCents,
        executionMode: "MANUAL",
      });
      await recordCommercialMetricFactInTransaction(transaction, {
        workspaceId: context.workspaceId,
        eventKey: `stage-history:${initialHistory.id}:entered:v1`,
        eventType: "STAGE_ENTERED",
        occurredAt: now,
        sourceEntityType: "StageHistory",
        sourceEntityId: initialHistory.id,
        leadId: lead.id,
        opportunityId: opportunity.id,
        pipelineId: pipeline.id,
        stageId: initialStage.id,
        creditedMemberId: closer.id,
        performedByMemberId: context.memberId,
        opportunityOwnerMemberIdAtEvent: closer.id,
        executionMode: "MANUAL",
      });
      await recordCommercialMetricFactInTransaction(transaction, {
        workspaceId: context.workspaceId,
        eventKey: `task:${task.id}:created:v1`,
        eventType: "TASK_CREATED",
        occurredAt: now,
        sourceEntityType: "Task",
        sourceEntityId: task.id,
        leadId: lead.id,
        opportunityId: opportunity.id,
        taskId: task.id,
        creditedMemberId: closer.id,
        performedByMemberId: context.memberId,
        opportunityOwnerMemberIdAtEvent: closer.id,
        taskKind: task.kind,
        executionMode: "MANUAL",
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

  async function transition(context: AuthenticatedContext, payload: unknown, policy: { requireIntegratedSale?: boolean } = {}) {
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
      if (targetCode === "WON" && policy.requireIntegratedSale) {
        conflict("INTEGRATED_SALE_REQUIRED", "Para marcar como ganho, revise e confirme o fechamento integrado com os dados do cliente e as condições comerciais.");
      }
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
        await reconcileCommissionsInTransaction(transaction, context, effectiveAt, opportunity.id, options.now());
      }
      if (targetCode === "WON" && opportunity.offers[0]) {
        await transaction.offer.update({
          where: { id: opportunity.offers[0].id },
          data: { acceptedAt: effectiveAt, updatedByActorId: context.actorId, updatedAt: effectiveAt },
        });
      }
      let outcomeSnapshotId: string | null = null;
      if (targetCode === "WON" || targetCode === "LOST") {
        const outcomeSnapshot = await transaction.opportunityOutcomeSnapshot.create({
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
        outcomeSnapshotId = outcomeSnapshot.id;
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
      const transitionDimensions = {
        workspaceId: context.workspaceId,
        occurredAt: effectiveAt,
        leadId: opportunity.leadId,
        activityId: activity.id,
        opportunityId: opportunity.id,
        pipelineId: opportunity.pipelineId,
        creditedMemberId: opportunity.ownerMemberId,
        performedByMemberId: context.memberId,
        opportunityOwnerMemberIdAtEvent: opportunity.ownerMemberId,
        executionMode: "MANUAL" as const,
      };
      await recordCommercialMetricFactInTransaction(transaction, {
        ...transitionDimensions,
        eventKey: `stage-history:${history.id}:exited:v1`,
        eventType: "STAGE_EXITED",
        sourceEntityType: "StageHistory",
        sourceEntityId: history.id,
        stageId: opportunity.currentStageId,
        fromStageId: opportunity.currentStageId,
        toStageId: target.id,
      });
      await recordCommercialMetricFactInTransaction(transaction, {
        ...transitionDimensions,
        eventKey: `stage-history:${enteredHistory.id}:entered:v1`,
        eventType: "STAGE_ENTERED",
        sourceEntityType: "StageHistory",
        sourceEntityId: enteredHistory.id,
        stageId: target.id,
        fromStageId: opportunity.currentStageId,
        toStageId: target.id,
      });
      if (targetCode === "WON" || targetCode === "LOST") {
        const outcomeEvent = targetCode === "WON" ? "OPPORTUNITY_WON" as const : "OPPORTUNITY_LOST" as const;
        await recordCommercialMetricFactInTransaction(transaction, {
          ...transitionDimensions,
          eventKey: `opportunity-outcome:${outcomeSnapshotId}:${outcomeEvent.toLowerCase()}:v1`,
          eventType: outcomeEvent,
          sourceEntityType: "OpportunityOutcomeSnapshot",
          sourceEntityId: outcomeSnapshotId!,
          stageId: target.id,
          valueCents: opportunity.amountCents,
          result: targetCode,
        });
        if (targetCode === "WON") {
          await recordCommercialMetricFactInTransaction(transaction, {
            ...transitionDimensions,
            eventKey: `opportunity-outcome:${outcomeSnapshotId}:sale-won:v1`,
            eventType: "SALE_WON",
            sourceEntityType: "OpportunityOutcomeSnapshot",
            sourceEntityId: outcomeSnapshotId!,
            stageId: target.id,
            valueCents: opportunity.amountCents,
            result: "WON",
          });
        }
      }
      for (const cancelledTask of cancelledTasks) {
        await recordCommercialMetricFactInTransaction(transaction, {
          ...transitionDimensions,
          eventKey: `task:${cancelledTask.id}:cancelled:opportunity:${enteredHistory.id}:v1`,
          eventType: "TASK_CANCELLED",
          sourceEntityType: "Task",
          sourceEntityId: cancelledTask.id,
          taskId: cancelledTask.id,
          result: targetCode,
          executionMode: "SYSTEM",
        });
      }
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
      await recordCommercialMetricFactInTransaction(transaction, {
        workspaceId: context.workspaceId,
        eventKey: `offer:${offer.id}:proposal-reached:v1`,
        eventType: "PROPOSAL_REACHED",
        occurredAt: effectiveAt,
        sourceEntityType: "Offer",
        sourceEntityId: offer.id,
        leadId: opportunity.leadId,
        activityId: activity.id,
        opportunityId: opportunity.id,
        pipelineId: opportunity.pipelineId,
        stageId: proposalStage.id,
        creditedMemberId: opportunity.ownerMemberId,
        performedByMemberId: context.memberId,
        opportunityOwnerMemberIdAtEvent: opportunity.ownerMemberId,
        valueCents: totalCents,
        result: "SENT",
        executionMode: "MANUAL",
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
      await syncActiveProspectingCommercialStageInTransaction(transaction, context, {
        leadId: opportunity.leadId,
        targetCode: "PROPOSAL",
        reason: `Proposta ${offer.name} registrada no negócio vinculado.`,
        commercialEvent: "PROPOSAL_REGISTERED",
      }, effectiveAt);
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

  return Object.freeze({ listCustomerSales, getCustomerSale, confirmCustomerSale, getPipelineScreen, getLeadScreen, create, transition, registerProposal, reopen });
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
