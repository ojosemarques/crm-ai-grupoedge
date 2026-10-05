import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { FreeQualificationScreen } from "@/modules/qualification/domain/free-qualification-contracts";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

type AuthorizationPort = Readonly<{
  authorize: (
    context: AuthenticatedContext,
    permissionKey: typeof PermissionKeys.LEADS_READ | typeof PermissionKeys.LEADS_WRITE,
    resource: ResourceScope,
  ) => Promise<AuthorizationDecision>;
  assertAuthorized: (
    context: AuthenticatedContext,
    permissionKey: typeof PermissionKeys.LEADS_READ | typeof PermissionKeys.LEADS_WRITE,
    resource: ResourceScope,
  ) => Promise<void>;
}>;

type FreeQualificationServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
}>;

const querySchema = z.object({ leadId: z.string().uuid() }).strict();
const createSchema = z.object({
  leadId: z.string().uuid(),
  content: z.string().trim().min(1, "Preencha a qualificação antes de salvar.").max(20_000),
}).strict();

type LeadScope = Readonly<{
  id: string;
  ownerMemberId: string | null;
  queueId: string | null;
  routingQueue: { teamId: string | null } | null;
  queue: { teamId: string | null } | null;
}>;

function invalidInput(error: z.ZodError): never {
  throw new ApplicationError(error.issues.map((issue) => issue.message).join(" "), {
    code: "INVALID_INPUT",
    statusCode: 400,
    expose: true,
  });
}

function resourceForLead(workspaceId: string, lead: LeadScope): ResourceScope {
  return {
    workspaceId,
    resourceType: "Lead",
    resourceId: lead.id,
    ownerMemberId: lead.ownerMemberId,
    queueId: lead.queueId,
    teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null,
  };
}

async function findLead(database: PrismaClient, workspaceId: string, leadId: string) {
  const lead = await database.lead.findFirst({
    where: { id: leadId, workspaceId, deletedAt: null },
    select: {
      id: true,
      lastActivityAt: true,
      nextActionAt: true,
      nextActionDescription: true,
      ownerMemberId: true,
      queueId: true,
      routingQueue: { select: { teamId: true } },
      queue: { select: { teamId: true } },
    },
  });
  if (!lead) {
    throw new ApplicationError("Lead não encontrado.", {
      code: "NOT_FOUND",
      statusCode: 404,
      expose: true,
    });
  }
  return lead;
}

export function createFreeQualificationService(options: FreeQualificationServiceOptions) {
  async function getScreen(
    context: AuthenticatedContext,
    payload: unknown,
  ): Promise<FreeQualificationScreen> {
    const parsed = querySchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await findLead(options.database, context.workspaceId, parsed.data.leadId);
    const resource = resourceForLead(context.workspaceId, lead);
    await options.authorization.assertAuthorized(context, PermissionKeys.LEADS_READ, resource);

    const [workspace, notes, writeDecision] = await Promise.all([
      options.database.workspace.findUniqueOrThrow({
        where: { id: context.workspaceId },
        select: { timeZone: true },
      }),
      options.database.note.findMany({
        where: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          opportunityId: null,
          deletedAt: null,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          body: true,
          createdAt: true,
          createdBy: { select: { displayName: true } },
        },
      }),
      options.authorization.authorize(context, PermissionKeys.LEADS_WRITE, resource),
    ]);

    return Object.freeze({
      leadId: lead.id,
      generatedAt: options.now().toISOString(),
      timeZone: workspace.timeZone,
      canWrite: writeDecision.allowed,
      entries: notes.map((note) => Object.freeze({
        id: note.id,
        content: note.body,
        createdAt: note.createdAt.toISOString(),
        createdBy: note.createdBy.displayName,
      })),
    });
  }

  async function create(
    context: AuthenticatedContext,
    payload: unknown,
  ): Promise<FreeQualificationScreen> {
    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const lead = await findLead(options.database, context.workspaceId, parsed.data.leadId);
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.LEADS_WRITE,
      resourceForLead(context.workspaceId, lead),
    );
    const occurredAt = options.now();

    await options.database.$transaction(async (transaction) => {
      const note = await transaction.note.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          body: parsed.data.content,
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
        select: { id: true },
      });
      await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: lead.id,
          type: "NOTE",
          direction: "INTERNAL",
          result: "INFORMATION",
          subject: "Qualificação registrada",
          description: parsed.data.content,
          occurredAt,
          nextActionAt: lead.nextActionAt,
          nextActionDescription: lead.nextActionDescription,
          newValues: { qualificationNoteId: note.id },
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      });
      await transaction.lead.update({
        where: { id: lead.id },
        data: {
          lastActivityAt: occurredAt > lead.lastActivityAt ? occurredAt : lead.lastActivityAt,
          updatedByActorId: context.actorId,
          updatedAt: occurredAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "lead.qualification_note.created",
          entityType: "Note",
          entityId: note.id,
          occurredAt,
          changes: { leadId: lead.id },
        },
      });
    });

    return getScreen(context, { leadId: lead.id });
  }

  return Object.freeze({ getScreen, create });
}

let service: ReturnType<typeof createFreeQualificationService> | undefined;

export function getFreeQualificationService() {
  service ??= createFreeQualificationService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return service;
}
