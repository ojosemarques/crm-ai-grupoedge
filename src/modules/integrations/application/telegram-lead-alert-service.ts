import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { ADVERTISING_PIPELINE_NAME } from "@/modules/pipelines/domain/prospecting-pipeline-profile";
import { canonicalJson } from "@/modules/integrations/domain/integration-policy";
import { buildTelegramLeadAlert, loadTelegramConfig, TELEGRAM_CONFIG_VERSION, TELEGRAM_CONNECTION_KEY, TELEGRAM_LEAD_JOB_KIND, TELEGRAM_RECIPIENT_EMAIL, telegramBindingSchema, telegramLeadJobSchema, telegramUpdateSchema } from "@/modules/integrations/domain/telegram-contracts";
import { TelegramTransport, TelegramTransportError } from "./telegram-transport";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { logger } from "@/shared/core/logging/logger";

type Options = Readonly<{ database: PrismaClient; now: () => Date; environment?: Readonly<Record<string, string | undefined>>; fetchImpl?: typeof fetch }>;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
type TelegramConnection = { id: string; workspaceId: string; updatedByActorId: string; version: number; schemaVersion: string; config: Prisma.JsonValue };

async function findConnection(database: Pick<Prisma.TransactionClient, "$queryRaw">, workspaceId?: string, enabledOnly = false): Promise<TelegramConnection | null> {
  const rows = await database.$queryRaw<TelegramConnection[]>(Prisma.sql`
    SELECT c.id,c."workspaceId",c."updatedByActorId",v.version,v."schemaVersion",v.config
    FROM integration_connections c JOIN workspaces w ON w.id=c."workspaceId"
    JOIN integration_connection_config_versions v ON v."workspaceId"=c."workspaceId" AND v."connectionId"=c.id AND v.version=c."currentConfigVersion"
    WHERE c.key=${TELEGRAM_CONNECTION_KEY} AND c."providerKey"='TELEGRAM' AND c.environment='PRODUCTION' AND c."capabilityLevel"='PRODUCTION'
      AND w.slug='politizai' AND w.status='ACTIVE' AND w."deletedAt" IS NULL
      ${workspaceId ? Prisma.sql`AND c."workspaceId"=${workspaceId}::uuid` : Prisma.empty}
      ${enabledOnly ? Prisma.sql`AND c.enabled=true AND c.status='CONNECTED'` : Prisma.empty}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function activeRecipient(database: Pick<Prisma.TransactionClient, "$queryRaw">, workspaceId: string, memberId: string) {
  const rows = await database.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT m.id FROM workspace_members m JOIN users u ON u.id=m."userId"
    WHERE m.id=${memberId}::uuid AND m."workspaceId"=${workspaceId}::uuid
      AND m.status='ACTIVE' AND m."deletedAt" IS NULL
      AND u."normalizedEmail"=${TELEGRAM_RECIPIENT_EMAIL} AND u.status='ACTIVE' AND u."deletedAt" IS NULL
  `);
  return rows[0] ?? null;
}

export async function enqueueTelegramLeadAlertInTransaction(transaction: Prisma.TransactionClient, input: Readonly<{ workspaceId: string; leadId: string; actorId: string; occurredAt: Date }>) {
  const connection = await findConnection(transaction, input.workspaceId);
  if (!connection || connection.schemaVersion !== TELEGRAM_CONFIG_VERSION) return;
  const binding = telegramBindingSchema.parse(connection.config);
  if (!await activeRecipient(transaction, input.workspaceId, binding.recipientMemberId)) return;
  const idempotencyKey = `telegram-ad-lead:${input.leadId}:carlos`;
  await transaction.job.upsert({
    where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey } }, update: {},
    create: { workspaceId: input.workspaceId, type: "NOTIFICATION", status: "PENDING", priority: 100, idempotencyKey, runAt: input.occurredAt, maxAttempts: 5,
      payload: { kind: TELEGRAM_LEAD_JOB_KIND, leadId: input.leadId, recipientMemberId: binding.recipientMemberId }, createdByActorId: input.actorId, updatedByActorId: input.actorId },
  });
}

export function createTelegramLeadAlertWorker(options: Options) {
  const config = loadTelegramConfig(options.environment ?? process.env);
  const transport = config ? new TelegramTransport(config.token, options.fetchImpl) : null;

  async function processNext(workerId: string, target?: Readonly<{ workspaceId: string; leadId: string }>): Promise<{ status: string }> {
    if (!config || !transport) return { status: "IDLE" as const };
    const connection = await findConnection(options.database, target?.workspaceId, true);
    if (!connection || connection.schemaVersion !== TELEGRAM_CONFIG_VERSION) return { status: "IDLE" as const };
    const binding = telegramBindingSchema.parse(connection.config);
    if (binding.state !== "CONNECTED" || !await activeRecipient(options.database, connection.workspaceId, binding.recipientMemberId)) return { status: "IDLE" as const };
    const now = options.now();
    const job = await options.database.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM jobs WHERE "workspaceId"=${connection.workspaceId}::uuid AND type='NOTIFICATION'
          AND payload->>'kind'=${TELEGRAM_LEAD_JOB_KIND}
          ${target ? Prisma.sql`AND payload->>'leadId'=${target.leadId}` : Prisma.empty}
          AND ((status='PENDING' AND "runAt"<=${now}) OR (status='RUNNING' AND "lockExpiresAt"<${now}))
        ORDER BY priority DESC,"runAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
      `);
      if (!rows[0]) return null;
      return tx.job.update({ where: { id: rows[0].id }, data: { status: "RUNNING", attempts: { increment: 1 }, lockedAt: now, lockedBy: workerId, lockExpiresAt: new Date(now.getTime() + 30000), lastAttemptAt: now } });
    });
    if (!job) return { status: "IDLE" as const };
    try {
      const payload = telegramLeadJobSchema.parse(job.payload);
      const lead = await options.database.lead.findFirst({ where: { id: payload.leadId, workspaceId: job.workspaceId, deletedAt: null, pipeline: { name: ADVERTISING_PIPELINE_NAME, deletedAt: null } }, select: { id: true, fullName: true, createdAt: true, submissions: { orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 1, select: { submittedAt: true } }, workspace: { select: { timeZone: true } } } });
      if (!lead || job.cancelRequestedAt || payload.recipientMemberId !== binding.recipientMemberId) {
        await options.database.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status: "CANCELLED", cancelledAt: now, finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: "TELEGRAM_LEAD_ALERT_STALE" } });
        return { status: "CANCELLED" as const };
      }
      const result = await transport.send({ chatId: binding.chatId, text: buildTelegramLeadAlert({ leadName: lead.fullName, receivedAt: lead.submissions[0]?.submittedAt ?? lead.createdAt, timeZone: lead.workspace.timeZone }), leadUrl: `${config.origin}/leads/${lead.id}/historico` });
      const finishedAt = options.now();
      await options.database.$transaction(async (tx) => {
        const changed = await tx.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status: "SUCCEEDED", result, finishedAt, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: null, lastError: null } });
        if (changed.count !== 1) return;
        await tx.integrationConnection.update({ where: { id: connection.id }, data: { lastSucceededAt: finishedAt, currentErrorCode: null, currentErrorMessage: null, updatedByActorId: job.updatedByActorId } });
        await tx.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: job.updatedByActorId, action: "lead.telegram_alert_sent", entityType: "Lead", entityId: lead.id, origin: "SYSTEM", occurredAt: finishedAt, changes: { jobId: job.id, telegramMessageId: result.messageId, recipientMemberId: binding.recipientMemberId } } });
      });
      return { status: "SUCCEEDED" as const };
    } catch (error) {
      const code = error instanceof TelegramTransportError ? error.code : "TELEGRAM_LEAD_ALERT_FAILED";
      const terminal = job.attempts >= job.maxAttempts || !(error instanceof TelegramTransportError && error.retryable);
      const delay = error instanceof TelegramTransportError && error.retryAfterSeconds ? error.retryAfterSeconds : Math.min(300, 5 * 2 ** Math.max(0, job.attempts - 1));
      await options.database.job.updateMany({ where: { id: job.id, status: "RUNNING", lockedBy: workerId }, data: { status: terminal ? "FAILED" : "PENDING", errorCode: code, lastError: "Falha no envio do aviso pelo Telegram.", runAt: new Date(options.now().getTime() + delay * 1000), finishedAt: terminal ? options.now() : null, lockedAt: null, lockedBy: null, lockExpiresAt: null } });
      return { status: terminal ? "FAILED" as const : "RETRY_PENDING" as const };
    }
  }
  return { processNext, processLead: (workspaceId: string, leadId: string) => processNext(`telegram-immediate:${leadId}`, { workspaceId, leadId }) };
}

export async function deliverTelegramLeadAlertAfterCommit(database: PrismaClient, workspaceId: string, leadId: string) {
  if (process.env.TELEGRAM_ENABLED !== "true") return;
  try { await createTelegramLeadAlertWorker({ database, now: () => new Date() }).processLead(workspaceId, leadId); }
  catch { logger.error({ errorCode: "TELEGRAM_IMMEDIATE_DISPATCH_FAILED", workspaceId, leadId }, "O aviso do Telegram permanece na fila para recuperação."); }
}

export async function deliverTelegramReceiptAlertAfterCommit(database: PrismaClient, workspaceId: string, receiptId: string) {
  if (process.env.TELEGRAM_ENABLED !== "true") return;
  try {
    const submission = await database.leadFormSubmission.findFirst({ where: { workspaceId, marketingFormReceiptId: receiptId }, select: { leadId: true } });
    if (submission?.leadId) await deliverTelegramLeadAlertAfterCommit(database, workspaceId, submission.leadId);
  } catch { logger.error({ errorCode: "TELEGRAM_RECEIPT_DISPATCH_FAILED", workspaceId, receiptId }, "O aviso do formulário permanece na fila para recuperação."); }
}

export function verifyTelegramWebhookSecret(supplied: string | null, environment: Readonly<Record<string, string | undefined>> = process.env) {
  const config = loadTelegramConfig(environment);
  if (!config) throw new ApplicationError("Integração Telegram desativada.", { code: "TELEGRAM_DISABLED", statusCode: 503, expose: true });
  const left = Buffer.from(supplied ?? ""), right = Buffer.from(config.webhookSecret);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new ApplicationError("Webhook não autorizado.", { code: "TELEGRAM_WEBHOOK_UNAUTHORIZED", statusCode: 401, expose: true });
}

export function createTelegramBindingService(options: Options) {
  return { async receive(raw: unknown) {
    const config = loadTelegramConfig(options.environment ?? process.env);
    if (!config) throw new Error("TELEGRAM_DISABLED");
    const update = telegramUpdateSchema.parse(raw), message = update.message;
    const match = message?.text?.match(/^\/start(?:@politizaibot)? ([A-Za-z0-9_-]{32,64})$/);
    if (!message || message.chat.type !== "private" || !message.from || message.from.is_bot || message.from.id !== message.chat.id || !match) return { status: "IGNORED" as const };
    const result = await options.database.$transaction(async (tx) => {
      let connection = await findConnection(tx);
      if (!connection) return { status: "IGNORED" as const };
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram-bind:${connection.id}`},0))`;
      connection = await findConnection(tx, connection.workspaceId);
      if (!connection || connection.schemaVersion !== TELEGRAM_CONFIG_VERSION) return { status: "IGNORED" as const };
      const binding = telegramBindingSchema.parse(connection.config);
      if (binding.state !== "PENDING" || new Date(binding.expiresAt) <= options.now() || Math.abs(options.now().getTime() - message.date * 1000) > 86400000 || sha256(match[1]!) !== binding.activationHash) return { status: "IGNORED" as const };
      if (!await activeRecipient(tx, connection.workspaceId, binding.recipientMemberId)) return { status: "IGNORED" as const };
      const next = { state: "CONNECTED" as const, recipientMemberId: binding.recipientMemberId, chatId: String(message.chat.id), telegramUserId: String(message.from!.id) };
      await tx.integrationConnectionConfigVersion.create({ data: { workspaceId: connection.workspaceId, connectionId: connection.id, version: connection.version + 1, schemaVersion: TELEGRAM_CONFIG_VERSION, config: next, configHash: sha256(canonicalJson(next)), createdByActorId: connection.updatedByActorId } });
      await tx.integrationConnection.update({ where: { id: connection.id }, data: { currentConfigVersion: connection.version + 1, revision: { increment: 1 }, enabled: true, status: "CONNECTED", lastSucceededAt: options.now() } });
      await tx.auditLog.create({ data: { workspaceId: connection.workspaceId, actorId: connection.updatedByActorId, action: "integration.telegram.carlos_connected", entityType: "IntegrationConnection", entityId: connection.id, origin: "SYSTEM", changes: { recipientMemberId: binding.recipientMemberId, updateId: update.update_id } } });
      return { status: "CONNECTED" as const };
    });
    if (result.status === "CONNECTED") {
      try { await new TelegramTransport(config.token, options.fetchImpl).send({ chatId: String(message.chat.id), text: "Carlos, os avisos do CRM Politizai foram ativados neste Telegram. Você receberá os novos leads de anúncios com um botão para abrir o CRM." }); }
      catch { logger.warn({ errorCode: "TELEGRAM_BINDING_CONFIRMATION_FAILED" }, "Vínculo Telegram salvo; confirmação não enviada."); }
    }
    return result;
  } };
}
