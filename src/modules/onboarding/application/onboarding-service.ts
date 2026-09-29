import { Prisma, type OnboardingEventType, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  addWorkspaceDays,
  canTransitionHandoff,
  canTransitionOnboarding,
  createHandoffSchema,
  handoffActionSchema,
  onboardingActionSchema,
} from "@/modules/onboarding/domain/onboarding-contracts";
import { createAuthorizationService, type ResourceScope } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Transaction = Prisma.TransactionClient;
type ServiceOptions = Readonly<{ database: PrismaClient; now: () => Date }>;
const SERIALIZABLE_MAX_ATTEMPTS = 4;

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function resource(
  context: AuthenticatedContext,
  id?: string,
  ownerMemberId?: string | null,
  teamId?: string | null,
  queueId?: string | null,
): ResourceScope {
  return {
    workspaceId: context.workspaceId,
    resourceType: "Onboarding",
    resourceId: id ?? context.workspaceId,
    memberId: context.memberId,
    ...(ownerMemberId === undefined ? {} : { ownerMemberId }),
    ...(teamId === undefined ? {} : { teamId }),
    ...(queueId === undefined ? {} : { queueId }),
  };
}

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function withSerializableRetry<T>(
  database: PrismaClient,
  operation: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === SERIALIZABLE_MAX_ATTEMPTS) throw error;
    }
  }
  throw new Error("Limite de tentativas serializáveis atingido.");
}

async function appendEvent(
  transaction: Transaction,
  input: Readonly<{
    workspaceId: string;
    handoffId?: string;
    caseId?: string;
    milestoneId?: string;
    type: OnboardingEventType;
    previous?: string;
    next: string;
    reason: string;
    actorId: string;
    key: string;
    now: Date;
    metadata?: unknown;
  }>,
) {
  const existing = await transaction.onboardingEvent.findUnique({
    where: {
      workspaceId_idempotencyKey: {
        workspaceId: input.workspaceId,
        idempotencyKey: input.key,
      },
    },
  });
  if (existing) return existing;
  const last = await transaction.onboardingEvent.findFirst({
    where: input.caseId
      ? { workspaceId: input.workspaceId, onboardingCaseId: input.caseId }
      : { workspaceId: input.workspaceId, handoffId: input.handoffId ?? null },
    orderBy: { sequence: "desc" },
  });
  return transaction.onboardingEvent.create({
    data: {
      workspaceId: input.workspaceId,
      sequence: (last?.sequence ?? 0) + 1,
      type: input.type,
      newStatus: input.next,
      reason: input.reason,
      actorId: input.actorId,
      idempotencyKey: input.key,
      occurredAt: input.now,
      ...(input.handoffId ? { handoffId: input.handoffId } : {}),
      ...(input.caseId ? { onboardingCaseId: input.caseId } : {}),
      ...(input.milestoneId ? { milestoneId: input.milestoneId } : {}),
      ...(input.previous ? { previousStatus: input.previous } : {}),
      ...(input.metadata === undefined ? {} : { safeMetadata: json(input.metadata) }),
    },
  });
}

export function createOnboardingService(options: ServiceOptions) {
  const authorization = createAuthorizationService({ database: options.database });

  async function screen(context: AuthenticatedContext) {
    await authorization.assertAuthorized(
      context,
      PermissionKeys.ONBOARDING_READ,
      resource(context, undefined, context.memberId),
    );
    const [handoffs, cases, templates, members, acceptedContracts] = await Promise.all([
      options.database.customerHandoff.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: { requestedAt: "desc" },
      }),
      options.database.onboardingCase.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: [{ nextActionAt: "asc" }, { createdAt: "desc" }],
      }),
      options.database.onboardingTemplateVersion.findMany({
        where: { workspaceId: context.workspaceId, status: "PUBLISHED" },
        orderBy: { version: "desc" },
      }),
      options.database.workspaceMember.findMany({
        where: { workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null },
        include: { user: true },
        orderBy: { user: { displayName: "asc" } },
      }),
      options.database.commercialContract.findMany({
        where: { workspaceId: context.workspaceId, status: "ACCEPTED" },
        select: { id: true, opportunityId: true, contractNumber: true },
      }),
    ]);

    const visibleCases = [];
    for (const item of cases) {
      const decision = await authorization.authorize(
        context,
        PermissionKeys.ONBOARDING_READ,
        resource(context, item.id, item.ownerMemberId, item.teamId, item.queueId),
      );
      if (decision.allowed) visibleCases.push(item);
    }
    const visibleHandoffs = [];
    for (const item of handoffs) {
      const decision = await authorization.authorize(
        context,
        PermissionKeys.ONBOARDING_READ,
        resource(context, item.id, item.toMemberId, null, item.toQueueId),
      );
      if (decision.allowed) visibleHandoffs.push(item);
    }

    const caseIds = visibleCases.map((item) => item.id);
    const [milestones, events] = await Promise.all([
      caseIds.length
        ? options.database.onboardingMilestone.findMany({
            where: { workspaceId: context.workspaceId, onboardingCaseId: { in: caseIds } },
            orderBy: [{ onboardingCaseId: "asc" }, { position: "asc" }],
          })
        : [],
      options.database.onboardingEvent.findMany({
        where: {
          workspaceId: context.workspaceId,
          OR: [
            { onboardingCaseId: { in: caseIds } },
            { handoffId: { in: visibleHandoffs.map((item) => item.id) } },
          ],
        },
        orderBy: { occurredAt: "desc" },
        take: 100,
      }),
    ]);

    const contractByOpportunity = new Map(
      acceptedContracts.map((contract) => [contract.opportunityId, contract]),
    );
    const existingOpportunityIds = new Set(
      handoffs.flatMap((handoff) => handoff.opportunityId ? [handoff.opportunityId] : []),
    );
    const opportunityIds = [...contractByOpportunity.keys()].filter(
      (id) => !existingOpportunityIds.has(id),
    );
    const eligibleOpportunities = opportunityIds.length
      ? await options.database.opportunity.findMany({
          where: {
            workspaceId: context.workspaceId,
            id: { in: opportunityIds },
            status: "WON",
            accountId: { not: null },
            deletedAt: null,
          },
          include: { account: true },
          orderBy: { closedAt: "desc" },
        })
      : [];
    const now = options.now();
    const readyToActivate = visibleCases.filter((item) =>
      item.status === "IN_PROGRESS" &&
      !milestones.some((milestone) =>
        milestone.onboardingCaseId === item.id &&
        milestone.required &&
        milestone.status !== "COMPLETED"),
    ).length;

    return {
      generatedAt: now.toISOString(),
      timeZone: "America/Sao_Paulo",
      formulas: {
        overdue: "casos abertos com targetAt anterior ao instante da consulta",
        readyToActivate: "casos em andamento sem marco obrigatório pendente",
      },
      metrics: {
        awaitingSend: visibleHandoffs.filter((item) => ["DRAFT", "READY"].includes(item.status)).length,
        awaitingAcceptance: visibleHandoffs.filter((item) => ["SENT", "REQUESTED"].includes(item.status)).length,
        inProgress: visibleCases.filter((item) => item.status === "IN_PROGRESS").length,
        blocked: visibleCases.filter((item) => item.status === "BLOCKED").length,
        overdue: visibleCases.filter((item) =>
          !["COMPLETED", "CANCELLED"].includes(item.status) && item.targetAt < now,
        ).length,
        readyToActivate,
      },
      handoffs: visibleHandoffs,
      cases: visibleCases.map((item) => ({
        ...item,
        milestones: milestones.filter((milestone) => milestone.onboardingCaseId === item.id),
      })),
      events,
      templates,
      members: members.map((member) => ({ id: member.id, name: member.user.displayName })),
      eligibleOpportunities: eligibleOpportunities.map((opportunity) => ({
        id: opportunity.id,
        name: opportunity.name,
        accountName: opportunity.account?.name ?? "Conta não identificada",
        ownerMemberId: opportunity.ownerMemberId,
        contractId: contractByOpportunity.get(opportunity.id)?.id ?? null,
        contractNumber: contractByOpportunity.get(opportunity.id)?.contractNumber ?? null,
      })),
      permissions: {
        manage: (await authorization.authorize(context, PermissionKeys.ONBOARDING_MANAGE, resource(context, undefined, context.memberId))).allowed,
        accept: (await authorization.authorize(context, PermissionKeys.ONBOARDING_ACCEPT, resource(context, undefined, context.memberId))).allowed,
        execute: (await authorization.authorize(context, PermissionKeys.ONBOARDING_EXECUTE, resource(context, undefined, context.memberId))).allowed,
        assign: (await authorization.authorize(context, PermissionKeys.ONBOARDING_ASSIGN, resource(context, undefined, context.memberId))).allowed,
        correct: (await authorization.authorize(context, PermissionKeys.ONBOARDING_CORRECT, resource(context, undefined, context.memberId))).allowed,
      },
    };
  }

  async function createHandoff(context: AuthenticatedContext, raw: unknown) {
    const input = createHandoffSchema.parse(raw);
    return withSerializableRetry(options.database, async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`onboarding-handoff:${context.workspaceId}:${input.opportunityId}`}, 0))`;
      const replay = await transaction.onboardingEvent.findUnique({
        where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } },
      });
      if (replay?.handoffId) {
        return transaction.customerHandoff.findFirstOrThrow({
          where: { workspaceId: context.workspaceId, id: replay.handoffId },
        });
      }
      const opportunity = await transaction.opportunity.findFirst({
        where: { workspaceId: context.workspaceId, id: input.opportunityId, deletedAt: null },
        include: { account: true, offers: true },
      });
      if (!opportunity) fail("Oportunidade não encontrada.", "ONBOARDING_OPPORTUNITY_NOT_FOUND", 404);
      await authorization.assertAuthorized(
        context,
        PermissionKeys.ONBOARDING_MANAGE,
        resource(context, opportunity.id, opportunity.ownerMemberId),
      );
      if (opportunity.status !== "WON") fail("Somente oportunidade ganha pode iniciar handoff.", "ONBOARDING_OPPORTUNITY_NOT_WON");
      if (!opportunity.accountId || !opportunity.account) fail("A oportunidade precisa de conta canônica.", "ONBOARDING_ACCOUNT_REQUIRED");
      const activeHandoff = await transaction.customerHandoff.findFirst({
        where: {
          workspaceId: context.workspaceId,
          opportunityId: opportunity.id,
          status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (activeHandoff) return activeHandoff;
      const contract = await transaction.commercialContract.findFirst({
        where: { workspaceId: context.workspaceId, opportunityId: opportunity.id, status: "ACCEPTED" },
        orderBy: { acceptedAt: "desc" },
      });
      if (!contract) fail("Contrato aceito é obrigatório pela versão vigente.", "ONBOARDING_CONTRACT_REQUIRED");
      const template = await transaction.onboardingTemplateVersion.findFirst({
        where: { workspaceId: context.workspaceId, status: "PUBLISHED" },
        orderBy: { version: "desc" },
      });
      if (!template) fail("Template de onboarding publicado não encontrado.", "ONBOARDING_TEMPLATE_REQUIRED");
      const owner = await transaction.workspaceMember.findFirst({
        where: { workspaceId: context.workspaceId, id: input.ownerMemberId, status: "ACTIVE", deletedAt: null },
      });
      if (!owner) fail("Responsável de onboarding inválido.", "ONBOARDING_OWNER_REQUIRED");
      const handoff = await transaction.customerHandoff.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: opportunity.leadId,
          opportunityId: opportunity.id,
          accountId: opportunity.accountId,
          contractId: contract.id,
          templateVersionId: template.id,
          fromMemberId: opportunity.ownerMemberId,
          toMemberId: owner.id,
          status: "DRAFT",
          reason: input.reason,
          snapshot: json({
            accountName: opportunity.account.name,
            opportunityName: opportunity.name,
            amountCents: opportunity.amountCents.toString(),
            mrrCents: opportunity.mrrCents.toString(),
            tcvCents: opportunity.tcvCents.toString(),
            currency: opportunity.currency,
            contractNumber: contract.contractNumber,
            contractAcceptedAt: contract.acceptedAt?.toISOString() ?? null,
            offerIds: opportunity.offers.map((offer) => offer.id),
          }),
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
        },
      });
      await appendEvent(transaction, {
        workspaceId: context.workspaceId,
        handoffId: handoff.id,
        type: "HANDOFF_CREATED",
        next: "DRAFT",
        reason: input.reason,
        actorId: context.actorId,
        key: input.idempotencyKey,
        now: options.now(),
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "onboarding.handoff.created",
          entityType: "CustomerHandoff",
          entityId: handoff.id,
          origin: "API",
          changes: { opportunityId: opportunity.id, contractId: contract.id, ownerMemberId: owner.id, status: "DRAFT" },
        },
      });
      return handoff;
    });
  }

  async function actHandoff(context: AuthenticatedContext, id: string, raw: unknown) {
    const input = handoffActionSchema.parse(raw);
    return withSerializableRetry(options.database, async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`onboarding-handoff-action:${context.workspaceId}:${id}`}, 0))`;
      const current = await transaction.customerHandoff.findFirst({ where: { workspaceId: context.workspaceId, id } });
      if (!current) fail("Handoff não encontrado.", "ONBOARDING_HANDOFF_NOT_FOUND", 404);
      const permission = input.action === "ACCEPT" || input.action === "REJECT"
        ? PermissionKeys.ONBOARDING_ACCEPT
        : PermissionKeys.ONBOARDING_MANAGE;
      await authorization.assertAuthorized(context, permission, resource(context, id, current.toMemberId, null, current.toQueueId));
      const replay = await transaction.onboardingEvent.findUnique({
        where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } },
      });
      if (replay) {
        return {
          handoff: current,
          onboarding: await transaction.onboardingCase.findFirst({ where: { workspaceId: context.workspaceId, handoffId: id } }),
          idempotent: true,
        };
      }
      const target = {
        MARK_READY: "READY",
        SEND: "SENT",
        ACCEPT: "ACCEPTED",
        REJECT: "REJECTED",
        CANCEL: "CANCELLED",
      } as const satisfies Record<typeof input.action, string>;
      const targetStatus = target[input.action];
      if (!canTransitionHandoff(current.status, targetStatus)) {
        fail(`Transição ${current.status} → ${targetStatus} inválida.`, "ONBOARDING_INVALID_HANDOFF_TRANSITION");
      }
      const now = options.now();
      const timestamps = targetStatus === "READY" ? { readyAt: now }
        : targetStatus === "SENT" ? { sentAt: now }
        : targetStatus === "ACCEPTED" ? { acceptedAt: now }
        : targetStatus === "REJECTED" ? { rejectedAt: now }
        : { cancelledAt: now };
      const changed = await transaction.customerHandoff.updateMany({
        where: { workspaceId: context.workspaceId, id, revision: input.expectedRevision },
        data: { status: targetStatus, revision: { increment: 1 }, updatedByActorId: context.actorId, ...timestamps },
      });
      if (changed.count !== 1) fail("O handoff foi atualizado por outra pessoa.", "ONBOARDING_REVISION_CONFLICT");
      let onboarding = null;
      if (targetStatus === "ACCEPTED") {
        if (!current.accountId || !current.opportunityId || !current.contractId || !current.templateVersionId || !current.toMemberId) {
          fail("Handoff legado incompleto exige revisão.", "ONBOARDING_HANDOFF_REVIEW_REQUIRED");
        }
        const version = await transaction.onboardingTemplateVersion.findFirstOrThrow({
          where: { workspaceId: context.workspaceId, id: current.templateVersionId },
        });
        onboarding = await transaction.onboardingCase.create({
          data: {
            workspaceId: context.workspaceId,
            handoffId: id,
            accountId: current.accountId,
            opportunityId: current.opportunityId,
            contractId: current.contractId,
            templateVersionId: version.id,
            ownerMemberId: current.toMemberId,
            status: "PENDING",
            nextActionDescription: "Iniciar onboarding",
            nextActionAt: now,
            targetAt: addWorkspaceDays(now, version.expectedDurationDays),
            createdByActorId: context.actorId,
            updatedByActorId: context.actorId,
          },
        });
        const definitions = await transaction.onboardingTemplateMilestone.findMany({
          where: { workspaceId: context.workspaceId, templateVersionId: version.id },
          orderBy: { position: "asc" },
        });
        for (const definition of definitions) {
          await transaction.onboardingMilestone.create({
            data: {
              workspaceId: context.workspaceId,
              onboardingCaseId: onboarding.id,
              templateMilestoneId: definition.id,
              key: definition.key,
              nameSnapshot: definition.name,
              position: definition.position,
              required: definition.required,
              dependsOnKey: definition.dependsOnKey,
              ownerMemberId: current.toMemberId,
              dueAt: new Date(now.getTime() + definition.expectedDurationHours * 3_600_000),
            },
          });
        }
      }
      const eventTypes = {
        MARK_READY: "HANDOFF_READY",
        SEND: "HANDOFF_SENT",
        ACCEPT: "HANDOFF_ACCEPTED",
        REJECT: "HANDOFF_REJECTED",
        CANCEL: "HANDOFF_CANCELLED",
      } satisfies Record<typeof input.action, OnboardingEventType>;
      await appendEvent(transaction, {
        workspaceId: context.workspaceId,
        handoffId: id,
        ...(onboarding ? { caseId: onboarding.id } : {}),
        type: eventTypes[input.action],
        previous: current.status,
        next: targetStatus,
        reason: input.reason,
        actorId: context.actorId,
        key: input.idempotencyKey,
        now,
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: `onboarding.handoff.${input.action.toLowerCase()}`,
          entityType: "CustomerHandoff",
          entityId: id,
          origin: "API",
          changes: {
            before: { status: current.status, revision: current.revision },
            after: { status: targetStatus, revision: current.revision + 1 },
            reason: input.reason,
            onboardingCaseId: onboarding?.id ?? null,
          },
        },
      });
      return {
        handoff: await transaction.customerHandoff.findUniqueOrThrow({ where: { id } }),
        onboarding,
        idempotent: false,
      };
    });
  }

  async function actOnboarding(context: AuthenticatedContext, id: string, raw: unknown) {
    const input = onboardingActionSchema.parse(raw);
    return withSerializableRetry(options.database, async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`onboarding-case-action:${context.workspaceId}:${id}`}, 0))`;
      const current = await transaction.onboardingCase.findFirst({ where: { workspaceId: context.workspaceId, id } });
      if (!current) fail("Onboarding não encontrado.", "ONBOARDING_CASE_NOT_FOUND", 404);
      const permission = input.action === "REASSIGN"
        ? PermissionKeys.ONBOARDING_ASSIGN
        : input.action === "CANCEL"
          ? PermissionKeys.ONBOARDING_CORRECT
          : PermissionKeys.ONBOARDING_EXECUTE;
      await authorization.assertAuthorized(context, permission, resource(context, id, current.ownerMemberId, current.teamId, current.queueId));
      const replay = await transaction.onboardingEvent.findUnique({
        where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } },
      });
      if (replay) return { case: current, idempotent: true };
      if (input.action === "COMPLETE_MILESTONE") {
        const milestone = await transaction.onboardingMilestone.findFirst({
          where: { workspaceId: context.workspaceId, id: input.milestoneId, onboardingCaseId: id },
        });
        if (!milestone) fail("Marco não encontrado.", "ONBOARDING_MILESTONE_NOT_FOUND", 404);
        if (milestone.dependsOnKey) {
          const dependency = await transaction.onboardingMilestone.findFirst({
            where: { workspaceId: context.workspaceId, onboardingCaseId: id, key: milestone.dependsOnKey, status: "COMPLETED" },
          });
          if (!dependency) fail("Conclua primeiro o marco dependente.", "ONBOARDING_MILESTONE_DEPENDENCY");
        }
        const changed = await transaction.onboardingMilestone.updateMany({
          where: { id: milestone.id, workspaceId: context.workspaceId, revision: input.expectedRevision },
          data: { status: "COMPLETED", completedAt: options.now(), evidence: input.evidence, revision: { increment: 1 } },
        });
        if (changed.count !== 1) fail("O marco foi atualizado por outra pessoa.", "ONBOARDING_REVISION_CONFLICT");
        await appendEvent(transaction, {
          workspaceId: context.workspaceId,
          caseId: id,
          milestoneId: milestone.id,
          type: "MILESTONE_COMPLETED",
          previous: milestone.status,
          next: "COMPLETED",
          reason: input.reason,
          actorId: context.actorId,
          key: input.idempotencyKey,
          now: options.now(),
          metadata: { evidenceRecorded: true },
        });
        await transaction.auditLog.create({
          data: {
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            action: "onboarding.milestone.completed",
            entityType: "OnboardingMilestone",
            entityId: milestone.id,
            origin: "API",
            changes: { before: { status: milestone.status }, after: { status: "COMPLETED" }, reason: input.reason },
          },
        });
        return { case: current, idempotent: false };
      }
      if (input.action === "REASSIGN") {
        const owner = await transaction.workspaceMember.findFirst({
          where: { workspaceId: context.workspaceId, id: input.ownerMemberId, status: "ACTIVE", deletedAt: null },
        });
        if (!owner) fail("Responsável inválido.", "ONBOARDING_OWNER_REQUIRED");
        const changed = await transaction.onboardingCase.updateMany({
          where: { id, workspaceId: context.workspaceId, revision: input.expectedRevision },
          data: { ownerMemberId: owner.id, queueId: null, revision: { increment: 1 }, updatedByActorId: context.actorId },
        });
        if (changed.count !== 1) fail("O onboarding foi atualizado por outra pessoa.", "ONBOARDING_REVISION_CONFLICT");
        await appendEvent(transaction, {
          workspaceId: context.workspaceId,
          caseId: id,
          type: "ONBOARDING_REASSIGNED",
          previous: current.status,
          next: current.status,
          reason: input.reason,
          actorId: context.actorId,
          key: input.idempotencyKey,
          now: options.now(),
          metadata: { ownerMemberId: owner.id },
        });
        return { case: await transaction.onboardingCase.findUniqueOrThrow({ where: { id } }), idempotent: false };
      }
      const target = {
        START: "IN_PROGRESS",
        BLOCK: "BLOCKED",
        UNBLOCK: "IN_PROGRESS",
        ACTIVATE: "ACTIVATED",
        COMPLETE: "COMPLETED",
        CANCEL: "CANCELLED",
      } as const satisfies Record<typeof input.action, string>;
      const targetStatus = target[input.action];
      if (!canTransitionOnboarding(current.status, targetStatus)) {
        fail(`Transição ${current.status} → ${targetStatus} inválida.`, "ONBOARDING_INVALID_CASE_TRANSITION");
      }
      if (targetStatus === "ACTIVATED") {
        const incomplete = await transaction.onboardingMilestone.count({
          where: { workspaceId: context.workspaceId, onboardingCaseId: id, required: true, status: { not: "COMPLETED" } },
        });
        if (incomplete > 0) fail("Todos os marcos obrigatórios precisam de evidência.", "ONBOARDING_REQUIRED_MILESTONES");
      }
      const now = options.now();
      const data: Prisma.OnboardingCaseUpdateManyMutationInput = {
        status: targetStatus,
        revision: { increment: 1 },
        updatedByActorId: context.actorId,
      };
      if (targetStatus === "IN_PROGRESS" && !current.startedAt) data.startedAt = now;
      if (targetStatus === "BLOCKED") {
        data.blockingReasonCode = input.action === "BLOCK" ? input.reasonCode : "OTHER";
        data.blockingComment = input.reason;
        data.nextActionDescription = "Resolver bloqueio";
      }
      if (input.action === "UNBLOCK") {
        data.blockingReasonCode = null;
        data.blockingComment = null;
        data.nextActionDescription = "Continuar onboarding";
      }
      if (targetStatus === "ACTIVATED") {
        data.activatedAt = now;
        data.nextActionDescription = "Concluir onboarding";
      }
      if (targetStatus === "COMPLETED") data.completedAt = now;
      if (targetStatus === "CANCELLED") data.cancelledAt = now;
      const changed = await transaction.onboardingCase.updateMany({
        where: { id, workspaceId: context.workspaceId, revision: input.expectedRevision },
        data,
      });
      if (changed.count !== 1) fail("O onboarding foi atualizado por outra pessoa.", "ONBOARDING_REVISION_CONFLICT");
      if (targetStatus === "COMPLETED") {
        await transaction.customerHandoff.updateMany({
          where: { workspaceId: context.workspaceId, id: current.handoffId, status: "ACCEPTED" },
          data: { status: "COMPLETED", completedAt: now, updatedByActorId: context.actorId, revision: { increment: 1 } },
        });
      }
      const eventTypes = {
        START: "ONBOARDING_STARTED",
        BLOCK: "ONBOARDING_BLOCKED",
        UNBLOCK: "ONBOARDING_UNBLOCKED",
        ACTIVATE: "CUSTOMER_ACTIVATED",
        COMPLETE: "ONBOARDING_COMPLETED",
        CANCEL: "ONBOARDING_CANCELLED",
      } satisfies Record<typeof input.action, OnboardingEventType>;
      await appendEvent(transaction, {
        workspaceId: context.workspaceId,
        caseId: id,
        type: eventTypes[input.action],
        previous: current.status,
        next: targetStatus,
        reason: input.reason,
        actorId: context.actorId,
        key: input.idempotencyKey,
        now,
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: `onboarding.case.${input.action.toLowerCase()}`,
          entityType: "OnboardingCase",
          entityId: id,
          origin: "API",
          changes: {
            before: { status: current.status, revision: current.revision },
            after: { status: targetStatus, revision: current.revision + 1 },
            reason: input.reason,
          },
        },
      });
      return { case: await transaction.onboardingCase.findUniqueOrThrow({ where: { id } }), idempotent: false };
    });
  }

  return { screen, createHandoff, actHandoff, actOnboarding };
}

let singleton: ReturnType<typeof createOnboardingService> | undefined;

export function getOnboardingService() {
  singleton ??= createOnboardingService({ database: getDatabaseClient(), now: () => new Date() });
  return singleton;
}
