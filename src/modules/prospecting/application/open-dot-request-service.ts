import { Prisma, type OpenDotScope, type PrismaClient } from "@/generated/prisma/client";

import {
  authenticateOpenDotRequest,
  loadOpenDotClients,
  sha256,
  type OpenDotPrincipal,
} from "@/modules/prospecting/domain/open-dot-policy";
import { openDotHeadersSchema, type OpenDotScopeValue } from "@/modules/prospecting/domain/prospecting-contracts";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type OpenDotResponse = Readonly<{ status: number; body: Record<string, unknown> }>;

type Options = Readonly<{
  database: PrismaClient;
  now: () => Date;
  environment: NodeJS.ProcessEnv;
}>;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function createOpenDotRequestService(options: Options) {
  async function execute(input: Readonly<{
    method: string;
    path: string;
    rawBody: string;
    rawHeaders: unknown;
    requiredScope: OpenDotScopeValue;
    handler: (transaction: Prisma.TransactionClient, principal: OpenDotPrincipal) => Promise<OpenDotResponse>;
  }>): Promise<OpenDotResponse & { idempotentReplay: boolean }> {
    const headers = openDotHeadersSchema.parse(input.rawHeaders);
    const clients = loadOpenDotClients(options.environment);
    let principal: OpenDotPrincipal;
    try {
      principal = authenticateOpenDotRequest({
        clients,
        clientId: headers.clientId,
        requiredScope: input.requiredScope,
        method: input.method,
        path: input.path,
        timestamp: headers.timestamp,
        nonce: headers.nonce,
        rawBody: input.rawBody,
        signature: headers.signature,
        now: options.now(),
      });
    } catch (error) {
      const configured = clients.find((client) => client.clientId === headers.clientId);
      if (configured && error instanceof ApplicationError) {
        const systemActor = await options.database.actor.findFirst({ where: { workspaceId: configured.workspaceId, type: "SYSTEM", key: "system" }, select: { id: true } });
        if (systemActor) {
          await options.database.auditLog.create({ data: { workspaceId: configured.workspaceId, actorId: systemActor.id, action: "open_dot.request_denied", entityType: "OpenDotClient", entityId: configured.actorId, occurredAt: options.now(), changes: { clientId: headers.clientId, method: input.method, path: input.path, requiredScope: input.requiredScope, code: error.code } } });
        }
      }
      throw error;
    }
    const actor = await options.database.actor.findFirst({
      where: { id: principal.actorId, workspaceId: principal.workspaceId, type: { in: ["AI_AGENT", "AUTOMATION"] }, userId: null },
      select: { id: true },
    });
    if (!actor) {
      throw new ApplicationError("Ator técnico Open-Dot inválido.", { code: "OPEN_DOT_SERVICE_ACTOR_INVALID", statusCode: 403, expose: true });
    }
    const requestHash = sha256(input.rawBody);
    const nonceHash = sha256(headers.nonce);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await options.database.$transaction(async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`open-dot:${principal.workspaceId}:${principal.clientId}:${headers.idempotencyKey}`}, 0))`;
          const previous = await transaction.openDotRequestReceipt.findUnique({
            where: { workspaceId_clientId_idempotencyKey: {
              workspaceId: principal.workspaceId,
              clientId: principal.clientId,
              idempotencyKey: headers.idempotencyKey,
            } },
          });
          if (previous) {
            if (previous.requestHash !== requestHash || previous.endpoint !== input.path) {
              throw new ApplicationError("Chave idempotente reutilizada com requisição diferente.", { code: "OPEN_DOT_IDEMPOTENCY_CONFLICT", statusCode: 409, expose: true });
            }
            return { status: previous.responseStatus, body: previous.responseBody as Record<string, unknown>, idempotentReplay: true };
          }
          const replay = await transaction.openDotRequestReceipt.findUnique({
            where: { workspaceId_clientId_nonceHash: {
              workspaceId: principal.workspaceId,
              clientId: principal.clientId,
              nonceHash,
            } },
            select: { id: true },
          });
          if (replay) {
            throw new ApplicationError("Nonce Open-Dot já utilizado.", { code: "OPEN_DOT_NONCE_REPLAY", statusCode: 409, expose: true });
          }
          const response = await input.handler(transaction, principal);
          await transaction.openDotRequestReceipt.create({
            data: {
              workspaceId: principal.workspaceId,
              clientId: principal.clientId,
              scope: input.requiredScope as OpenDotScope,
              endpoint: input.path,
              idempotencyKey: headers.idempotencyKey,
              nonceHash,
              requestHash,
              responseStatus: response.status,
              responseBody: json(response.body),
              receivedAt: options.now(),
            },
          });
          return { ...response, idempotentReplay: false };
        }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") || attempt === 2) throw error;
      }
    }
    throw new Error("OPEN_DOT_SERIALIZABLE_RETRY_EXHAUSTED");
  }

  return Object.freeze({ execute });
}

let singleton: ReturnType<typeof createOpenDotRequestService> | undefined;

export function getOpenDotRequestService() {
  singleton ??= createOpenDotRequestService({
    database: getDatabaseClient(),
    now: () => new Date(),
    environment: process.env,
  });
  return singleton;
}
