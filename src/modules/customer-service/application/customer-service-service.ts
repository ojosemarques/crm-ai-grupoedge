import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  assignCustomerRequestSchema,
  calculateSatisfaction,
  classifySurvey,
  customerRequestActionSchema,
  customerServiceQuerySchema,
  elapsedSeconds,
  nextCustomerRequestStatus,
  openCustomerRequestSchema,
  publishSlaVersionSchema,
  publishSurveyVersionSchema,
  surveyInvitationSchema,
  surveyResponseSchema,
} from "@/modules/customer-service/domain/customer-service-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Authorization = ReturnType<typeof getAuthorizationService>;
type Options = Readonly<{ database: PrismaClient; authorization: Authorization; now: () => Date }>;
type RequestRecord = Awaited<ReturnType<PrismaClient["customerRequest"]["findFirstOrThrow"]>>;

function fail(message: string, code = "INVALID_INPUT", statusCode = 400): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}
function requestResource(workspaceId: string, id?: string, ownerMemberId?: string | null, teamId?: string | null, queueId?: string | null) {
  return { workspaceId, resourceType: "CustomerRequest", ...(id ? { resourceId: id } : {}), ...(ownerMemberId !== undefined ? { ownerMemberId } : {}), ...(teamId !== undefined ? { teamId } : {}), ...(queueId !== undefined ? { queueId } : {}) };
}
async function lock(tx: Prisma.TransactionClient, workspaceId: string, key: string) {
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${workspaceId}:${key}`}))::text AS "lockResult"`);
}
async function appendEvent(tx: Prisma.TransactionClient, input: { workspaceId: string; requestId: string; accountId: string; actorId: string; type: "CREATED" | "ASSIGNED" | "FIRST_RESPONSE" | "NEXT_ACTION_UPDATED" | "STATUS_CHANGED" | "RESOLVED" | "CLOSED" | "REOPENED" | "CORRECTED"; previousStatus?: string | null; newStatus: string; reason: string; idempotencyKey: string; occurredAt: Date; safeMetadata?: Prisma.InputJsonValue }) {
  const latest = await tx.customerRequestEvent.findFirst({ where: { workspaceId: input.workspaceId, requestId: input.requestId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
  return tx.customerRequestEvent.create({ data: { ...input, previousStatus: input.previousStatus ?? null, sequence: (latest?.sequence ?? 0) + 1, safeMetadata: input.safeMetadata ?? Prisma.JsonNull } });
}
function audit(tx: Prisma.TransactionClient, context: AuthenticatedContext, action: string, entityId: string, reason: string, changes: Prisma.InputJsonValue) {
  return tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action, entityType: "CustomerRequest", entityId, reason, changes } });
}
function retryable(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034"; }

export function createCustomerServiceService(options: Options) {
  async function screen(context: AuthenticatedContext, raw: unknown = {}) {
    const query = customerServiceQuerySchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SERVICE_READ, requestResource(context.workspaceId, undefined, context.memberId));
    const now = options.now();
    let surveyAccountIds: string[] | undefined;
    if (query.surveyType) {
      const definitions = await options.database.customerSurveyDefinition.findMany({ where: { workspaceId: context.workspaceId, type: query.surveyType }, select: { id: true } });
      const versions = await options.database.customerSurveyVersion.findMany({ where: { workspaceId: context.workspaceId, definitionId: { in: definitions.map((item) => item.id) } }, select: { id: true } });
      const invitations = await options.database.customerSurveyInvitation.findMany({ where: { workspaceId: context.workspaceId, surveyVersionId: { in: versions.map((item) => item.id) }, ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } } : {}) }, select: { accountId: true } });
      surveyAccountIds = [...new Set(invitations.map((item) => item.accountId))];
    }
    const where: Prisma.CustomerRequestWhereInput = {
      workspaceId: context.workspaceId,
      ...(query.ownerMemberId ? { ownerMemberId: query.ownerMemberId } : {}), ...(query.teamId ? { teamId: query.teamId } : {}), ...(query.queueId ? { queueId: query.queueId } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}), ...(surveyAccountIds ? { AND: [{ accountId: { in: surveyAccountIds } }] } : {}), ...(query.category ? { category: query.category } : {}), ...(query.priority ? { priority: query.priority } : {}),
      ...(query.status ? { status: query.status } : {}), ...(query.channel ? { channel: query.channel } : {}), ...(query.slaPolicyVersionId ? { slaPolicyVersionId: query.slaPolicyVersionId } : {}),
      ...(query.sla === "FIRST_RESPONSE_OVERDUE" ? { firstRespondedAt: null, firstResponseDueAt: { lt: now }, status: { notIn: ["RESOLVED", "CLOSED"] } } : {}),
      ...(query.sla === "RESOLUTION_OVERDUE" ? { resolvedAt: null, resolutionDueAt: { lt: now }, status: { notIn: ["RESOLVED", "CLOSED"] } } : {}),
      ...(query.sla === "RESOLVED_WITHIN" ? { resolutionBreached: false, status: { in: ["RESOLVED", "CLOSED"] } } : {}),
      ...((query.from || query.to) ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } } : {}),
    };
    const candidates = await options.database.customerRequest.findMany({ where, orderBy: [{ priority: "desc" }, { firstResponseDueAt: "asc" }, { resolutionDueAt: "asc" }, { createdAt: "asc" }] });
    const visible: typeof candidates = [];
    for (const item of candidates) if ((await options.authorization.authorize(context, PermissionKeys.CUSTOMER_SERVICE_READ, requestResource(context.workspaceId, item.id, item.ownerMemberId, item.teamId, item.queueId))).allowed) visible.push(item);
    const priorityRank = { URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1 } as const;
    visible.sort((left, right) => priorityRank[right.priority] - priorityRank[left.priority] || left.firstResponseDueAt.getTime() - right.firstResponseDueAt.getTime() || left.resolutionDueAt.getTime() - right.resolutionDueAt.getTime() || left.createdAt.getTime() - right.createdAt.getTime());
    const accountIds = [...new Set(visible.map((item) => item.accountId))];
    const [accounts, members, queues, versions, invitations, responses, portfolio, canCreate, canAssign, canRespond, canResolve, canReopen, canConfigure, canSeeSatisfaction] = await Promise.all([
      options.database.account.findMany({ where: { workspaceId: context.workspaceId, id: { in: accountIds }, deletedAt: null }, select: { id: true, name: true, segment: true } }),
      options.database.workspaceMember.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true, user: { select: { displayName: true } } }, orderBy: { user: { displayName: "asc" } } }),
      options.database.queue.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true, teamId: true }, orderBy: { name: "asc" } }),
      options.database.customerServiceSlaPolicyVersion.findMany({ where: { workspaceId: context.workspaceId }, select: { id: true, version: true, firstResponseMinutes: true, resolutionMinutes: true, timeZone: true, policyId: true } }),
      options.database.customerSurveyInvitation.findMany({ where: { workspaceId: context.workspaceId, accountId: { in: accountIds }, ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } } : {}) } }),
      options.database.customerSurveyResponse.findMany({ where: { workspaceId: context.workspaceId, accountId: { in: accountIds }, ...(query.from || query.to ? { answeredAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } } : {}) } }),
      options.database.customerPortfolioAssignment.findMany({ where: { workspaceId: context.workspaceId, validTo: null }, select: { accountId: true, ownerMemberId: true, teamId: true, queueId: true, nextActionAt: true } }),
      options.authorization.authorize(context, PermissionKeys.CUSTOMER_SERVICE_CREATE, requestResource(context.workspaceId, undefined, context.memberId)),
      options.authorization.authorize(context, PermissionKeys.CUSTOMER_SERVICE_ASSIGN, requestResource(context.workspaceId, undefined, context.memberId)),
      options.authorization.authorize(context, PermissionKeys.CUSTOMER_SERVICE_RESPOND, requestResource(context.workspaceId, undefined, context.memberId)),
      options.authorization.authorize(context, PermissionKeys.CUSTOMER_SERVICE_RESOLVE, requestResource(context.workspaceId, undefined, context.memberId)),
      options.authorization.authorize(context, PermissionKeys.CUSTOMER_SERVICE_REOPEN, requestResource(context.workspaceId, undefined, context.memberId)),
      options.authorization.authorize(context, PermissionKeys.CUSTOMER_SERVICE_CONFIG_MANAGE, requestResource(context.workspaceId, undefined, context.memberId)),
      options.authorization.authorize(context, PermissionKeys.CUSTOMER_SERVICE_SATISFACTION_READ, requestResource(context.workspaceId, undefined, context.memberId)),
    ]);
    const accountMap = new Map(accounts.map((item) => [item.id, item])); const memberMap = new Map(members.map((item) => [item.id, item.user.displayName])); const queueMap = new Map(queues.map((item) => [item.id, item.name]));
    const open = visible.filter((item) => !["RESOLVED", "CLOSED"].includes(item.status));
    const resolved = visible.filter((item) => item.resolvedAt && (!query.from || item.resolvedAt >= query.from) && (!query.to || item.resolvedAt < query.to));
    const withinSla = resolved.filter((item) => item.resolutionBreached === false).length;
    const activeResponses = responses.filter((item) => !responses.some((candidate) => candidate.supersedesId === item.id));
    const versionType = new Map((await options.database.customerSurveyVersion.findMany({ where: { workspaceId: context.workspaceId }, select: { id: true, definitionId: true } })).map((item) => [item.id, item.definitionId]));
    const definitions = await options.database.customerSurveyDefinition.findMany({ where: { workspaceId: context.workspaceId }, select: { id: true, type: true, name: true } });
    const definitionType = new Map(definitions.map((item) => [item.id, item.type]));
    const satisfaction = (["CSAT", "NPS"] as const).map((type) => {
      const versionIds = [...versionType.entries()].filter(([, definitionId]) => definitionType.get(definitionId) === type).map(([id]) => id);
      const typeInvitations = invitations.filter((item) => versionIds.includes(item.surveyVersionId)); const values = activeResponses.filter((item) => versionIds.includes(item.surveyVersionId)).map((item) => item.value);
      return { type, ...calculateSatisfaction(type, values, typeInvitations.length), invitationCount: typeInvitations.length };
    });
    const availableAccountIds: string[] = [];
    if (canCreate.allowed) for (const assignment of portfolio) if ((await options.authorization.authorize(context, PermissionKeys.CUSTOMER_SERVICE_CREATE, requestResource(context.workspaceId, undefined, assignment.ownerMemberId, assignment.teamId, assignment.queueId))).allowed) availableAccountIds.push(assignment.accountId);
    const availableAccounts = await options.database.account.findMany({ where: { workspaceId: context.workspaceId, id: { in: availableAccountIds }, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    const latestLow = new Map<string, typeof activeResponses[number]>();
    for (const response of [...activeResponses].sort((a, b) => b.answeredAt.getTime() - a.answeredAt.getTime())) if (!latestLow.has(response.accountId) && ["DETRACTOR", "DISSATISFIED"].includes(response.classification)) latestLow.set(response.accountId, response);
    const portfolioMap = new Map(portfolio.map((item) => [item.accountId, item]));
    const lowWithoutAction = [...latestLow.keys()].filter((id) => !portfolioMap.get(id)?.nextActionAt).length;
    const items = visible.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map((item) => ({ ...item, account: accountMap.get(item.accountId)!, ownerName: item.ownerMemberId ? memberMap.get(item.ownerMemberId) ?? "Responsável" : null, queueName: item.queueId ? queueMap.get(item.queueId) ?? "Fila" : null, firstResponseOverdue: !item.firstRespondedAt && item.firstResponseDueAt < now, resolutionOverdue: !item.resolvedAt && item.resolutionDueAt < now }));
    return { generatedAt: now.toISOString(), timeZone: "America/Sao_Paulo", total: visible.length, page: query.page, pageSize: query.pageSize, items, members: members.map((item) => ({ id: item.id, name: item.user.displayName })), queues, versions, availableAccounts,
      metrics: { open: open.length, firstResponseOverdue: open.filter((item) => !item.firstRespondedAt && item.firstResponseDueAt < now).length, resolutionOverdue: open.filter((item) => item.resolutionDueAt < now).length, withinSlaRate: resolved.length ? withinSla / resolved.length : null, resolvedEligible: resolved.length, lowSatisfactionWithoutAction: lowWithoutAction },
      satisfaction: canSeeSatisfaction.allowed ? satisfaction : satisfaction.map((item) => ({ ...item, value: null, validResponses: 0, responseRate: null, invitationCount: 0, distribution: {} })), formulas: { period: "[from,to) por createdAt; resolução por resolvedAt", withinSla: "resolvidas sem violação / resolvidas elegíveis", csat: "média das respostas válidas", nps: "% promotores - % detratores", noData: "ausência permanece nula" },
      permissions: { create: canCreate.allowed, assign: canAssign.allowed, respond: canRespond.allowed, resolve: canResolve.allowed, reopen: canReopen.allowed, configure: canConfigure.allowed, satisfaction: canSeeSatisfaction.allowed } };
  }

  async function detail(context: AuthenticatedContext, requestId: string) {
    const item = await options.database.customerRequest.findFirst({ where: { id: requestId, workspaceId: context.workspaceId } });
    if (!item) fail("Solicitação não encontrada.", "NOT_FOUND", 404);
    await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SERVICE_READ, requestResource(context.workspaceId, item.id, item.ownerMemberId, item.teamId, item.queueId));
    const [account, contact, events, invitations] = await Promise.all([
      options.database.account.findFirstOrThrow({ where: { workspaceId: context.workspaceId, id: item.accountId }, select: { id: true, name: true, segment: true } }),
      item.contactId ? options.database.contact.findFirst({ where: { workspaceId: context.workspaceId, id: item.contactId }, select: { id: true, preferredName: true } }) : null,
      options.database.customerRequestEvent.findMany({ where: { workspaceId: context.workspaceId, requestId }, orderBy: { sequence: "desc" }, take: 100 }),
      options.database.customerSurveyInvitation.findMany({ where: { workspaceId: context.workspaceId, requestId }, orderBy: { createdAt: "desc" } }),
    ]);
    return { ...item, account, contact, events, invitations };
  }

  async function open(context: AuthenticatedContext, raw: unknown) {
    const input = openCustomerRequestSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SERVICE_CREATE, requestResource(context.workspaceId, undefined, input.ownerMemberId, input.teamId, input.queueId));
    const execute = () => options.database.$transaction(async (tx) => {
      await lock(tx, context.workspaceId, input.accountId);
      const replay = await tx.customerRequest.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } }); if (replay) return replay;
      if (!(await tx.account.findFirst({ where: { workspaceId: context.workspaceId, id: input.accountId, deletedAt: null } }))) fail("Conta não encontrada.", "NOT_FOUND", 404);
      if (input.contactId && !(await tx.contact.findFirst({ where: { workspaceId: context.workspaceId, id: input.contactId, deletedAt: null } }))) fail("Contato não encontrado no workspace.", "NOT_FOUND", 404);
      if (input.ownerMemberId && !(await tx.workspaceMember.findFirst({ where: { workspaceId: context.workspaceId, id: input.ownerMemberId, status: "ACTIVE", deletedAt: null } }))) fail("Responsável não está ativo.");
      const queue = input.queueId ? await tx.queue.findFirst({ where: { workspaceId: context.workspaceId, id: input.queueId, deletedAt: null } }) : null;
      if (input.queueId && !queue) fail("Fila não encontrada.");
      if (input.teamId && !(await tx.team.findFirst({ where: { workspaceId: context.workspaceId, id: input.teamId, deletedAt: null } }))) fail("Equipe não encontrada.");
      if (input.ownerMemberId && input.teamId && !(await tx.teamMember.findFirst({ where: { workspaceId: context.workspaceId, workspaceMemberId: input.ownerMemberId, teamId: input.teamId, deletedAt: null } }))) fail("O responsável não pertence à equipe informada.");
      if (queue?.teamId && input.teamId && queue.teamId !== input.teamId) fail("A fila não pertence à equipe informada.");
      const at = options.now(); const version = await tx.customerServiceSlaPolicyVersion.findFirst({ where: { workspaceId: context.workspaceId, status: "PUBLISHED", effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }, orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }] });
      if (!version) fail("Nenhuma política de SLA publicada está vigente.", "SLA_POLICY_MISSING", 409);
      const created = await tx.customerRequest.create({ data: { workspaceId: context.workspaceId, accountId: input.accountId, contactId: input.contactId ?? null, channel: input.channel, subject: input.subject, description: input.description, category: input.category, priority: input.priority, ownerMemberId: input.ownerMemberId ?? null, queueId: input.queueId ?? null, teamId: input.teamId ?? null, slaPolicyVersionId: version.id, firstResponseDueAt: new Date(at.getTime() + version.firstResponseMinutes * 60_000), resolutionDueAt: new Date(at.getTime() + version.resolutionMinutes * 60_000), nextActionDescription: input.nextActionDescription, nextActionAt: input.nextActionAt, idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId, updatedByActorId: context.actorId, createdAt: at, updatedAt: at } });
      await appendEvent(tx, { workspaceId: context.workspaceId, requestId: created.id, accountId: created.accountId, actorId: context.actorId, type: "CREATED", newStatus: created.status, reason: "Solicitação registrada explicitamente.", idempotencyKey: `${input.idempotencyKey}:event`, occurredAt: at, safeMetadata: { slaPolicyVersionId: version.id, firstResponseDueAt: created.firstResponseDueAt.toISOString(), resolutionDueAt: created.resolutionDueAt.toISOString() } });
      await audit(tx, context, "customer_service.request.created", created.id, "Solicitação registrada explicitamente.", { accountId: created.accountId, status: created.status, slaPolicyVersionId: version.id }); return created;
    }, { isolationLevel: "Serializable" });
    for (let attempt = 0; attempt < 3; attempt += 1) try { return await execute(); } catch (error) { const replay = await options.database.customerRequest.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } }); if (replay) return replay; if (!retryable(error) || attempt === 2) throw error; }
    fail("A solicitação concorrente não pôde ser registrada.", "CONCURRENT_REQUEST", 409);
  }

  async function assign(context: AuthenticatedContext, requestId: string, raw: unknown) {
    const input = assignCustomerRequestSchema.parse(raw); const current = await options.database.customerRequest.findFirst({ where: { workspaceId: context.workspaceId, id: requestId } }); if (!current) fail("Solicitação não encontrada.", "NOT_FOUND", 404);
    await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SERVICE_ASSIGN, requestResource(context.workspaceId, current.id, current.ownerMemberId, current.teamId, current.queueId));
    if (input.ownerMemberId && !(await options.database.workspaceMember.findFirst({ where: { workspaceId: context.workspaceId, id: input.ownerMemberId, status: "ACTIVE", deletedAt: null } }))) fail("Responsável não está ativo.");
    const targetQueue = input.queueId ? await options.database.queue.findFirst({ where: { workspaceId: context.workspaceId, id: input.queueId, deletedAt: null } }) : null;
    if (input.queueId && !targetQueue) fail("Fila não encontrada.");
    if (input.teamId && !(await options.database.team.findFirst({ where: { workspaceId: context.workspaceId, id: input.teamId, deletedAt: null } }))) fail("Equipe não encontrada.");
    if (input.ownerMemberId && input.teamId && !(await options.database.teamMember.findFirst({ where: { workspaceId: context.workspaceId, workspaceMemberId: input.ownerMemberId, teamId: input.teamId, deletedAt: null } }))) fail("O responsável não pertence à equipe informada.");
    if (targetQueue?.teamId && input.teamId && targetQueue.teamId !== input.teamId) fail("A fila não pertence à equipe informada.");
    await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SERVICE_ASSIGN, requestResource(context.workspaceId, current.id, input.ownerMemberId ?? null, input.teamId ?? null, input.queueId ?? null));
    return mutate(current, context, input.idempotencyKey, input.expectedRevision, "ASSIGNED", input.reason, async (tx, at) => ({ ownerMemberId: input.ownerMemberId ?? null, queueId: input.queueId ?? null, teamId: input.teamId ?? null, updatedByActorId: context.actorId, updatedAt: at }), { ownerMemberId: input.ownerMemberId ?? null, queueId: input.queueId ?? null, teamId: input.teamId ?? null });
  }

  async function mutate(current: RequestRecord, context: AuthenticatedContext, idempotencyKey: string, expectedRevision: number, type: "ASSIGNED" | "FIRST_RESPONSE" | "NEXT_ACTION_UPDATED" | "STATUS_CHANGED" | "RESOLVED" | "CLOSED" | "REOPENED", reason: string, data: (tx: Prisma.TransactionClient, at: Date) => Promise<Prisma.CustomerRequestUpdateManyMutationInput> | Prisma.CustomerRequestUpdateManyMutationInput, metadata: Prisma.InputJsonValue = {}) {
    return options.database.$transaction(async (tx) => {
      await lock(tx, context.workspaceId, current.id);
      if (await tx.customerRequestEvent.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: `${idempotencyKey}:event` } } })) return tx.customerRequest.findUniqueOrThrow({ where: { id: current.id } });
      const at = options.now(); const result = await tx.customerRequest.updateMany({ where: { id: current.id, workspaceId: context.workspaceId, revision: expectedRevision }, data: { ...(await data(tx, at)), revision: { increment: 1 } } });
      if (!result.count) fail("A solicitação foi alterada. Recarregue antes de continuar.", "REVISION_CONFLICT", 409);
      const updated = await tx.customerRequest.findUniqueOrThrow({ where: { id: current.id } });
      await appendEvent(tx, { workspaceId: context.workspaceId, requestId: current.id, accountId: current.accountId, actorId: context.actorId, type, previousStatus: current.status, newStatus: updated.status, reason, idempotencyKey: `${idempotencyKey}:event`, occurredAt: at, safeMetadata: metadata });
      await audit(tx, context, `customer_service.request.${type.toLowerCase()}`, current.id, reason, { previousStatus: current.status, newStatus: updated.status, ...metadata as object }); return updated;
    }, { isolationLevel: "Serializable" });
  }

  async function act(context: AuthenticatedContext, requestId: string, raw: unknown) {
    const input = customerRequestActionSchema.parse(raw); const current = await options.database.customerRequest.findFirst({ where: { workspaceId: context.workspaceId, id: requestId } }); if (!current) fail("Solicitação não encontrada.", "NOT_FOUND", 404);
    const permission = input.action === "REOPEN" ? PermissionKeys.CUSTOMER_SERVICE_REOPEN : input.action === "RESOLVE" || input.action === "CLOSE" ? PermissionKeys.CUSTOMER_SERVICE_RESOLVE : PermissionKeys.CUSTOMER_SERVICE_RESPOND;
    await options.authorization.assertAuthorized(context, permission, requestResource(context.workspaceId, current.id, current.ownerMemberId, current.teamId, current.queueId));
    const next = nextCustomerRequestStatus(current.status, input.action); if (!next) fail("Transição inválida para o estado atual.", "INVALID_TRANSITION", 409);
    if (input.action === "FIRST_RESPONSE" && current.firstRespondedAt) return current;
    if (["UPDATE_NEXT_ACTION", "WAIT_CUSTOMER", "REOPEN"].includes(input.action) && (!input.nextActionDescription || !input.nextActionAt)) fail("Próxima ação e prazo são obrigatórios.");
    if (input.action === "RESOLVE" && !input.resolutionNote) fail("A resolução explícita é obrigatória.");
    const type = input.action === "FIRST_RESPONSE" ? "FIRST_RESPONSE" : input.action === "UPDATE_NEXT_ACTION" ? "NEXT_ACTION_UPDATED" : input.action === "RESOLVE" ? "RESOLVED" : input.action === "CLOSE" ? "CLOSED" : input.action === "REOPEN" ? "REOPENED" : "STATUS_CHANGED";
    return mutate(current, context, input.idempotencyKey, input.expectedRevision, type, input.reason, (_tx, at) => {
      const base: Prisma.CustomerRequestUpdateManyMutationInput = { status: next, updatedByActorId: context.actorId, updatedAt: at };
      if (input.nextActionDescription && input.nextActionAt) Object.assign(base, { nextActionDescription: input.nextActionDescription, nextActionAt: input.nextActionAt });
      if (input.action === "FIRST_RESPONSE") Object.assign(base, { firstRespondedAt: at, firstResponseSeconds: elapsedSeconds(current.createdAt, at), firstResponseBreached: at > current.firstResponseDueAt });
      if (input.action === "RESOLVE") Object.assign(base, { resolvedAt: at, resolutionSeconds: elapsedSeconds(current.createdAt, at), resolutionBreached: at > current.resolutionDueAt, resolutionNote: input.resolutionNote });
      if (input.action === "CLOSE") Object.assign(base, { closedAt: at });
      if (input.action === "REOPEN") Object.assign(base, { resolvedAt: null, resolutionSeconds: null, resolutionBreached: null, closedAt: null, resolutionNote: null });
      return base;
    }, { action: input.action, resolutionNote: input.resolutionNote ?? null, nextActionAt: input.nextActionAt?.toISOString() ?? null });
  }

  async function publishSlaVersion(context: AuthenticatedContext, raw: unknown) {
    const input = publishSlaVersionSchema.parse(raw); await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SERVICE_CONFIG_MANAGE, requestResource(context.workspaceId, undefined, context.memberId));
    return options.database.$transaction(async (tx) => { await lock(tx, context.workspaceId, `sla:${input.policyKey}`); const replay = await tx.auditLog.findFirst({ where: { workspaceId: context.workspaceId, action: "customer_service.sla.published", metadata: { path: ["idempotencyKey"], equals: input.idempotencyKey } } }); if (replay) return tx.customerServiceSlaPolicyVersion.findFirstOrThrow({ where: { workspaceId: context.workspaceId, id: String((replay.changes as { versionId?: string })?.versionId) } }); const at = options.now(); let policy = await tx.customerServiceSlaPolicy.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: input.policyKey } } }); if (!policy) policy = await tx.customerServiceSlaPolicy.create({ data: { workspaceId: context.workspaceId, key: input.policyKey, name: input.name, createdByActorId: context.actorId, updatedByActorId: context.actorId, updatedAt: at } }); const latest = await tx.customerServiceSlaPolicyVersion.findFirst({ where: { workspaceId: context.workspaceId, policyId: policy.id }, orderBy: { version: "desc" } }); if (latest?.status === "PUBLISHED") await tx.customerServiceSlaPolicyVersion.update({ where: { id: latest.id }, data: { status: "RETIRED", effectiveTo: input.effectiveFrom } }); const version = await tx.customerServiceSlaPolicyVersion.create({ data: { workspaceId: context.workspaceId, policyId: policy.id, version: (latest?.version ?? 0) + 1, status: "PUBLISHED", firstResponseMinutes: input.firstResponseMinutes, resolutionMinutes: input.resolutionMinutes, timeZone: input.timeZone, effectiveFrom: input.effectiveFrom, publishedAt: at, createdByActorId: context.actorId } }); await tx.customerServiceSlaPolicy.update({ where: { id: policy.id }, data: { currentVersionId: version.id, name: input.name, updatedByActorId: context.actorId, updatedAt: at } }); await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "customer_service.sla.published", entityType: "CustomerServiceSlaPolicyVersion", entityId: version.id, changes: { versionId: version.id, version: version.version }, metadata: { idempotencyKey: input.idempotencyKey } } }); return version; }, { isolationLevel: "Serializable" });
  }

  async function publishSurveyVersion(context: AuthenticatedContext, raw: unknown) {
    const input = publishSurveyVersionSchema.parse(raw); await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SERVICE_CONFIG_MANAGE, requestResource(context.workspaceId, undefined, context.memberId));
    return options.database.$transaction(async (tx) => {
      await lock(tx, context.workspaceId, `survey:${input.definitionKey}`);
      const replay = await tx.auditLog.findFirst({ where: { workspaceId: context.workspaceId, action: "customer_service.survey.published", metadata: { path: ["idempotencyKey"], equals: input.idempotencyKey } } });
      if (replay) return tx.customerSurveyVersion.findFirstOrThrow({ where: { workspaceId: context.workspaceId, id: String((replay.changes as { versionId?: string })?.versionId) } });
      const at = options.now();
      let definition = await tx.customerSurveyDefinition.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: input.definitionKey } } });
      if (!definition) definition = await tx.customerSurveyDefinition.create({ data: { workspaceId: context.workspaceId, key: input.definitionKey, name: input.name, type: input.type, createdByActorId: context.actorId, updatedByActorId: context.actorId, updatedAt: at } });
      if (definition.type !== input.type) fail("O tipo da pesquisa não pode mudar entre versões.", "SURVEY_TYPE_CONFLICT", 409);
      const latest = await tx.customerSurveyVersion.findFirst({ where: { workspaceId: context.workspaceId, definitionId: definition.id }, orderBy: { version: "desc" } });
      if (latest?.status === "PUBLISHED") await tx.customerSurveyVersion.update({ where: { id: latest.id }, data: { status: "RETIRED", effectiveTo: input.effectiveFrom } });
      const version = await tx.customerSurveyVersion.create({ data: { workspaceId: context.workspaceId, definitionId: definition.id, version: (latest?.version ?? 0) + 1, status: "PUBLISHED", question: input.question, minValue: input.minValue, maxValue: input.maxValue, labels: input.labels ?? Prisma.JsonNull, effectiveFrom: input.effectiveFrom, publishedAt: at, createdByActorId: context.actorId } });
      await tx.customerSurveyDefinition.update({ where: { id: definition.id }, data: { currentVersionId: version.id, name: input.name, updatedByActorId: context.actorId, updatedAt: at } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "customer_service.survey.published", entityType: "CustomerSurveyVersion", entityId: version.id, changes: { type: input.type, version: version.version, versionId: version.id }, metadata: { idempotencyKey: input.idempotencyKey } } });
      return version;
    }, { isolationLevel: "Serializable" });
  }

  async function invite(context: AuthenticatedContext, raw: unknown) {
    const input = surveyInvitationSchema.parse(raw);
    const request = input.requestId ? await options.database.customerRequest.findFirst({ where: { workspaceId: context.workspaceId, id: input.requestId, accountId: input.accountId } }) : null;
    const assignment = request ? null : await options.database.customerPortfolioAssignment.findFirst({ where: { workspaceId: context.workspaceId, accountId: input.accountId, validTo: null } });
    await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SERVICE_RESPOND, requestResource(context.workspaceId, request?.id, request?.ownerMemberId ?? assignment?.ownerMemberId, request?.teamId ?? assignment?.teamId, request?.queueId ?? assignment?.queueId));
    return options.database.$transaction(async (tx) => { const replay = await tx.customerSurveyInvitation.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } }); if (replay) return replay; const at = options.now(); if (input.expiresAt <= at) fail("A validade do convite deve estar no futuro."); if (!(await tx.account.findFirst({ where: { workspaceId: context.workspaceId, id: input.accountId, deletedAt: null } }))) fail("Conta não encontrada.", "NOT_FOUND", 404); if (input.requestId) { const request = await tx.customerRequest.findFirst({ where: { workspaceId: context.workspaceId, id: input.requestId, accountId: input.accountId } }); if (!request || !["RESOLVED", "CLOSED"].includes(request.status)) fail("CSAT de solicitação exige resolução registrada.", "REQUEST_NOT_RESOLVED", 409); } const definition = await tx.customerSurveyDefinition.findFirst({ where: { workspaceId: context.workspaceId, type: input.surveyType, active: true, currentVersionId: { not: null } } }); const version = definition?.currentVersionId ? await tx.customerSurveyVersion.findFirst({ where: { workspaceId: context.workspaceId, id: definition.currentVersionId, status: "PUBLISHED", effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] } }) : null; if (!version) fail("Nenhuma pesquisa publicada está vigente.", "SURVEY_MISSING", 409); const invitation = await tx.customerSurveyInvitation.create({ data: { workspaceId: context.workspaceId, accountId: input.accountId, requestId: input.requestId ?? null, surveyVersionId: version.id, channel: input.channel, simulated: true, expiresAt: input.expiresAt, idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId, createdAt: at } }); await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "customer_service.survey.invitation_created", entityType: "CustomerSurveyInvitation", entityId: invitation.id, changes: { surveyType: input.surveyType, simulated: true, requestId: input.requestId ?? null } } }); return invitation; }, { isolationLevel: "Serializable" });
  }

  async function respondSurvey(context: AuthenticatedContext, raw: unknown) {
    const input = surveyResponseSchema.parse(raw);
    const invitationScope = await options.database.customerSurveyInvitation.findFirst({ where: { workspaceId: context.workspaceId, id: input.invitationId } });
    if (!invitationScope) fail("Convite não encontrado.", "NOT_FOUND", 404);
    const request = invitationScope.requestId ? await options.database.customerRequest.findFirst({ where: { workspaceId: context.workspaceId, id: invitationScope.requestId } }) : null;
    const assignment = request ? null : await options.database.customerPortfolioAssignment.findFirst({ where: { workspaceId: context.workspaceId, accountId: invitationScope.accountId, validTo: null } });
    await options.authorization.assertAuthorized(context, PermissionKeys.CUSTOMER_SERVICE_RESPOND, requestResource(context.workspaceId, request?.id, request?.ownerMemberId ?? assignment?.ownerMemberId, request?.teamId ?? assignment?.teamId, request?.queueId ?? assignment?.queueId));
    return options.database.$transaction(async (tx) => { await lock(tx, context.workspaceId, input.invitationId); const replay = await tx.customerSurveyResponse.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } }); if (replay) return replay; const invitation = await tx.customerSurveyInvitation.findFirst({ where: { workspaceId: context.workspaceId, id: input.invitationId } }); if (!invitation) fail("Convite não encontrado.", "NOT_FOUND", 404); const version = await tx.customerSurveyVersion.findFirstOrThrow({ where: { workspaceId: context.workspaceId, id: invitation.surveyVersionId } }); const definition = await tx.customerSurveyDefinition.findFirstOrThrow({ where: { workspaceId: context.workspaceId, id: version.definitionId } }); const at = input.answeredAt ?? options.now(); if (at < invitation.createdAt) fail("A resposta não pode anteceder o convite.", "INVALID_SURVEY_DATE", 409); if (at > invitation.expiresAt) fail("O convite expirou.", "INVITATION_EXPIRED", 409); const classification = classifySurvey(definition.type, input.value, version.minValue, version.maxValue); if (!classification) fail(`Valor fora da escala publicada ${version.minValue}–${version.maxValue}.`, "INVALID_SURVEY_VALUE", 409); const previous = input.supersedesId ? await tx.customerSurveyResponse.findFirst({ where: { workspaceId: context.workspaceId, id: input.supersedesId, invitationId: invitation.id } }) : null; if (input.supersedesId && !previous) fail("Resposta anterior não encontrada.", "NOT_FOUND", 404); if (invitation.status === "RESPONDED" && !previous) fail("O convite já foi respondido; correção exige referência ao fato anterior.", "ALREADY_RESPONDED", 409); const response = await tx.customerSurveyResponse.create({ data: { workspaceId: context.workspaceId, invitationId: invitation.id, accountId: invitation.accountId, surveyVersionId: version.id, value: input.value, classification, comment: input.comment ?? null, channel: invitation.channel, answeredAt: at, supersedesId: previous?.id ?? null, idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId, createdAt: options.now() } }); if (invitation.status !== "RESPONDED") await tx.customerSurveyInvitation.update({ where: { id: invitation.id }, data: { status: "RESPONDED", respondedAt: at } }); await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: previous ? "customer_service.survey.response_corrected" : "customer_service.survey.response_recorded", entityType: "CustomerSurveyResponse", entityId: response.id, reason: previous ? "Correção append-only da resposta anterior." : "Resposta simulada/manual registrada.", changes: { value: input.value, classification, supersedesId: previous?.id ?? null, commentPresent: Boolean(input.comment) } } }); return response; }, { isolationLevel: "Serializable" });
  }

  return Object.freeze({ screen, detail, open, assign, act, publishSlaVersion, publishSurveyVersion, invite, respondSurvey });
}

let service: ReturnType<typeof createCustomerServiceService> | undefined;
export function getCustomerServiceService() { service ??= createCustomerServiceService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() }); return service; }
