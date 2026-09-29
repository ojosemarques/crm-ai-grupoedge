import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { integrationAdapterRegistry, type IntegrationAdapterRegistry } from "@/modules/integrations/application/integration-adapter-registry";
import { environmentSecretResolver, type SecretResolver } from "@/modules/integrations/application/secret-resolver";
import { evaluatePrivacyInTransaction } from "@/modules/privacy/application/privacy-service";
import { LOCAL_MOCK_PROVIDER_KEY, localWebhookEnvelopeSchema, MAX_WEBHOOK_BYTES, WEBHOOK_TOLERANCE_SECONDS } from "@/modules/integrations/domain/integration-contracts";
import { redactSensitive, sha256, verifyLocalWebhookSignature } from "@/modules/integrations/domain/integration-policy";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Options = Readonly<{ database: PrismaClient; secrets: SecretResolver; adapters: IntegrationAdapterRegistry; now: () => Date }>;

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(redactSensitive(value))) as Prisma.InputJsonValue;
}

function fail(message: string, code: string, statusCode: number): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

export function createWebhookInboxService(options: Options) {
  async function receive(input: Readonly<{ workspaceSlug: string; connectionKey: string; rawBody: string; timestamp: string; signature: string }>) {
    const bytes = Buffer.byteLength(input.rawBody, "utf8");
    if (bytes > MAX_WEBHOOK_BYTES) fail("O webhook excede o limite de 256 KiB.", "WEBHOOK_TOO_LARGE", 413);
    const connection = await options.database.integrationConnection.findFirst({
      where: { key: input.connectionKey, workspace: { slug: input.workspaceSlug }, providerKey: LOCAL_MOCK_PROVIDER_KEY, environment: "LOCAL" },
      include: { secrets: { where: { alias: "webhook-hmac", disabledAt: null, present: true }, orderBy: { version: "desc" }, take: 1 }, workspace: { select: { id: true } } },
    });
    if (!connection || !connection.enabled || connection.status !== "ACTIVE_LOCAL") fail("Webhook local indisponível.", "WEBHOOK_NOT_AVAILABLE", 404);
    const reference = connection.secrets[0];
    const secret = reference ? await options.secrets.resolve(reference.referenceKey) : null;
    if (!secret) fail("Referência de assinatura local não resolvida.", "WEBHOOK_SECRET_UNAVAILABLE", 409);

    let candidate: unknown;
    try { candidate = JSON.parse(input.rawBody); } catch { fail("Payload JSON inválido.", "INVALID_WEBHOOK_PAYLOAD", 400); }
    const envelope = localWebhookEnvelopeSchema.parse(candidate);
    const signatureStatus = verifyLocalWebhookSignature({ secret, timestamp: input.timestamp, signature: input.signature, rawBody: input.rawBody, now: options.now(), toleranceSeconds: WEBHOOK_TOLERANCE_SECONDS });
    const payloadHash = sha256(input.rawBody);
    const nonceHash = sha256(envelope.nonce);
    const systemActor = await options.database.actor.findFirst({ where: { workspaceId: connection.workspace.id, type: "SYSTEM" }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!systemActor) fail("Ator de sistema não configurado.", "SYSTEM_ACTOR_MISSING", 409);

    const result = await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration-inbox:${connection.workspace.id}:${connection.id}:${envelope.eventId}`}, 0))`;
      const existing = await tx.webhookInbox.findUnique({ where: { workspaceId_connectionId_providerEventId: { workspaceId: connection.workspace.id, connectionId: connection.id, providerEventId: envelope.eventId } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) fail("O eventId já existe com conteúdo diferente.", "WEBHOOK_IDEMPOTENCY_CONFLICT", 409);
        return { id: existing.id, status: existing.status, idempotent: true };
      }
      const repeatedNonce = await tx.webhookInbox.findUnique({ where: { workspaceId_connectionId_nonceHash: { workspaceId: connection.workspace.id, connectionId: connection.id, nonceHash } } });
      if (repeatedNonce) fail("Nonce de webhook já utilizado.", "WEBHOOK_REPLAY_REJECTED", 409);
      const accepted = signatureStatus === "VERIFIED";
      const safePayload = accepted ? asJson(options.adapters.get(connection.adapterKey).normalizeInbound(envelope.data)) : undefined;
      let privacyOutcome: "ALLOW" | "DENY" | "REVIEW_REQUIRED" = "ALLOW";
      const leadId = accepted && typeof envelope.data.leadId === "string" ? envelope.data.leadId : null;
      if (leadId) {
        const decision = await evaluatePrivacyInTransaction(tx, { workspaceId: connection.workspace.id, actorId: systemActor.id, leadId, channel: "OTHER", intendedAction: "INTEGRATION_WEBHOOK_EFFECT" });
        privacyOutcome = decision.outcome;
      }
      const processed = accepted && privacyOutcome === "ALLOW";
      const row = await tx.webhookInbox.create({ data: {
        workspaceId: connection.workspace.id, connectionId: connection.id, providerEventId: envelope.eventId,
        eventType: envelope.eventType, contractVersion: envelope.contractVersion, payloadHash, nonceHash,
        payloadSizeBytes: bytes, payload: safePayload ?? Prisma.JsonNull, signatureStatus,
        externalOccurredAt: new Date(envelope.occurredAt), receivedAt: options.now(), status: processed ? "PROCESSED" : accepted ? "IGNORED" : "REJECTED",
        attempts: 1, errorClass: !processed && accepted ? "PRIVACY_BLOCKED" : null,
        errorCode: !accepted ? `WEBHOOK_SIGNATURE_${signatureStatus}` : !processed ? `PRIVACY_${privacyOutcome}` : null,
        errorMessage: !accepted ? "Assinatura inválida ou expirada." : !processed ? "Efeito bloqueado pela decisão de privacidade." : null,
        processedAt: processed ? options.now() : null, correlationId: envelope.eventId,
      } });
      await tx.integrationDeliveryAttempt.create({ data: { workspaceId: connection.workspace.id, kind: "INBOX", inboxId: row.id, attemptNumber: 1, status: processed ? "SUCCEEDED" : "FAILED", errorClass: row.errorClass, errorCode: row.errorCode, errorMessage: row.errorMessage, startedAt: row.receivedAt, finishedAt: options.now(), resultMetadata: asJson({ privacyOutcome, externalEgress: false }) } });
      await tx.auditLog.create({ data: { workspaceId: connection.workspace.id, actorId: systemActor.id, action: processed ? "integration.webhook.processed_local" : "integration.webhook.rejected", entityType: "WebhookInbox", entityId: row.id, requestId: envelope.eventId, changes: asJson({ signatureStatus, privacyOutcome, payloadHash, externalEgress: false }) } });
      return { id: row.id, status: row.status, idempotent: false, rejected: !accepted };
    }, { isolationLevel: "ReadCommitted" });
    if (result.rejected) fail("Assinatura de webhook inválida ou expirada.", `WEBHOOK_SIGNATURE_${signatureStatus}`, 401);
    return { id: result.id, status: result.status, idempotent: result.idempotent };
  }
  return Object.freeze({ receive });
}

let service: ReturnType<typeof createWebhookInboxService> | undefined;
export function getWebhookInboxService() {
  service ??= createWebhookInboxService({ database: getDatabaseClient(), secrets: environmentSecretResolver, adapters: integrationAdapterRegistry, now: () => new Date() });
  return service;
}
