import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { toLeadIntakeInput } from "@/modules/leads/application/lead-entry-mapper";
import {
  getLeadIntakeService,
  type LeadIntakeResult,
} from "@/modules/leads/application/lead-intake-service";
import { localWebhookRequestSchema } from "@/modules/leads/domain/lead-entry-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type IntakePort = Readonly<{
  intake: (
    payload: unknown,
    context: AuthenticatedContext,
  ) => Promise<LeadIntakeResult>;
}>;

type LocalWebhookServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: ReturnType<typeof getAuthorizationService>;
  intake: IntakePort;
  now: () => Date;
}>;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function invalidWebhook(message = "Payload do webhook local inválido.") {
  return new ApplicationError(message, {
    code: "INVALID_LOCAL_WEBHOOK",
    statusCode: 422,
    expose: true,
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createLocalLeadWebhookService(options: LocalWebhookServiceOptions) {
  async function authorize(context: AuthenticatedContext) {
    const queue = await options.database.queue.findFirst({
      where: { workspaceId: context.workspaceId, isGeneral: true, deletedAt: null },
      select: { id: true, teamId: true },
    });
    if (!queue) {
      throw new ApplicationError("A Fila Geral não está configurada.", {
        code: "INTAKE_CONFIGURATION_UNAVAILABLE",
        statusCode: 409,
        expose: true,
      });
    }
    await options.authorization.assertAuthorized(context, PermissionKeys.LEADS_WRITE, {
      workspaceId: context.workspaceId,
      resourceType: "LocalWebhookEvent",
      queueId: queue.id,
      teamId: queue.teamId,
    });
  }

  async function receive(payload: unknown, context: AuthenticatedContext) {
    await authorize(context);
    const parsed = localWebhookRequestSchema.safeParse(payload);
    if (!parsed.success) throw invalidWebhook();

    const receivedAt = options.now();
    const event = await options.database.$transaction(async (transaction) => {
      const lockKey = `local-webhook:${context.workspaceId}:${parsed.data.eventId}`;
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `;
      const existing = await transaction.webhookEvent.findUnique({
        where: {
          workspaceId_provider_externalEventId: {
            workspaceId: context.workspaceId,
            provider: "LOCAL_SIMULATOR",
            externalEventId: parsed.data.eventId,
          },
        },
        select: { id: true, status: true, payload: true },
      });
      if (existing) {
        if (canonicalJson(existing.payload) !== canonicalJson(payload)) {
          throw new ApplicationError(
            "A chave idempotente já foi usada por outro payload.",
            {
              code: "WEBHOOK_IDEMPOTENCY_CONFLICT",
              statusCode: 409,
              expose: true,
            },
          );
        }
        return { id: existing.id, status: existing.status, created: false as const };
      }

      const created = await transaction.webhookEvent.create({
        data: {
          workspaceId: context.workspaceId,
          provider: "LOCAL_SIMULATOR",
          externalEventId: parsed.data.eventId,
          eventType: parsed.data.eventType,
          status: "PROCESSING",
          payload: json(payload),
          createdByActorId: context.actorId,
          receivedAt,
        },
        select: { id: true, status: true },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "lead.webhook.received",
          entityType: "WebhookEvent",
          entityId: created.id,
          requestId: parsed.data.eventId,
          changes: json({ provider: "LOCAL_SIMULATOR", eventType: parsed.data.eventType }),
        },
      });
      return { ...created, created: true as const };
    });

    try {
      const result = await options.intake.intake(
        toLeadIntakeInput(parsed.data.lead, {
          channel: "LOCAL_WEBHOOK",
          idempotencyKey: `local-webhook:${parsed.data.eventId}`,
          formIdentifier: parsed.data.eventType,
          rawPayload: payload as Record<string, unknown>,
        }),
        context,
      );
      const processedAt = options.now();
      const status = result.outcome === "REJECTED" ? "FAILED" : "PROCESSED";

      await options.database.$transaction(async (transaction) => {
        await transaction.webhookEvent.update({
          where: { id: event.id },
          data: {
            status,
            processedAt,
            errorMessage:
              result.outcome === "REJECTED"
                ? result.issues.map((issue) => issue.message).join(" ").slice(0, 2_000)
                : null,
          },
        });
        if (event.created) {
          await transaction.auditLog.create({
            data: {
              workspaceId: context.workspaceId,
              actorId: context.actorId,
              action:
                result.outcome === "REJECTED"
                  ? "lead.webhook.rejected"
                  : "lead.webhook.processed",
              entityType: "WebhookEvent",
              entityId: event.id,
              requestId: parsed.data.eventId,
              changes: json({ status, outcome: result.outcome }),
            },
          });
        }
      });

      return {
        eventId: event.id,
        eventStatus: status,
        idempotentReplay: !event.created ||
          (result.outcome !== "REJECTED" && result.idempotentReplay),
        result,
      };
    } catch (error) {
      await options.database.$transaction(async (transaction) => {
        await transaction.webhookEvent.update({
          where: { id: event.id },
          data: {
            status: "FAILED",
            errorMessage: "Falha controlada durante o processamento. O evento pode ser reenviado com a mesma chave.",
            processedAt: options.now(),
          },
        });
        if (event.created) {
          await transaction.auditLog.create({
            data: {
              workspaceId: context.workspaceId,
              actorId: context.actorId,
              action: "lead.webhook.failed",
              entityType: "WebhookEvent",
              entityId: event.id,
              requestId: parsed.data.eventId,
            },
          });
        }
      });
      throw error;
    }
  }

  return Object.freeze({ receive });
}

let service: ReturnType<typeof createLocalLeadWebhookService> | undefined;

export function getLocalLeadWebhookService() {
  service ??= createLocalLeadWebhookService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    intake: getLeadIntakeService(),
    now: () => new Date(),
  });
  return service;
}
