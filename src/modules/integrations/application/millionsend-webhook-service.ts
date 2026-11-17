import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { getProspectingEmailService } from "@/modules/prospecting/application/prospecting-email-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

const webhookPayloadSchema = z.object({
  type: z.enum(["email.delivered", "email.bounced", "email.complained", "email.sent", "email.delivery_delayed", "email.opened", "email.clicked", "email.prefetched"]),
  created_at: z.string().datetime({ offset: true }),
  data: z.object({
    email_id: z.string().trim().min(3).max(500).optional(),
    id: z.string().trim().min(3).max(500).optional(),
  }).passthrough(),
}).passthrough();

const forwardedEvents = {
  "email.delivered": "DELIVERED",
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINT",
} as const;

type WebhookEnvironment = Readonly<Record<string, string | undefined>>;
type MillionSendEventInput = Readonly<{
  externalEventId: string;
  providerMessageId: string;
  type: "DELIVERED" | "BOUNCED" | "COMPLAINT";
  occurredAt: string;
  automaticReply: false;
  metadata: Readonly<Record<string, never>>;
}>;
type MillionSendEventResult = Readonly<{ matched: boolean; eventId?: string }>;

function fail(message: string, code: string, statusCode: number): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function decodeSecret(secret: string): Buffer {
  const encoded = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length < 16) fail("O webhook da MillionSend não está configurado.", "MILLIONSEND_WEBHOOK_CONFIGURATION_INVALID", 503);
  return decoded;
}

function validSignature(expected: string, header: string): boolean {
  return header.split(/\s+/).some((entry) => {
    const supplied = entry.startsWith("v1,") ? entry.slice(3) : entry;
    const left = Buffer.from(expected);
    const right = Buffer.from(supplied);
    return left.length === right.length && timingSafeEqual(left, right);
  });
}

export function resolveMillionSendEventWorkspace(rows: readonly Readonly<{ workspaceId: string }>[]): string | null {
  const workspaceIds = [...new Set(rows.map((row) => row.workspaceId))];
  if (workspaceIds.length > 1) fail("A mensagem da MillionSend pertence a mais de um workspace.", "MILLIONSEND_WEBHOOK_WORKSPACE_AMBIGUOUS", 409);
  return workspaceIds[0] ?? null;
}

async function recordMillionSendEvent(input: MillionSendEventInput): Promise<MillionSendEventResult> {
  const database = getDatabaseClient();
  return database.$transaction(async (transaction) => {
    const matches = await transaction.prospectingEmailJob.findMany({
      where: { providerMessageId: input.providerMessageId },
      select: { workspaceId: true },
      take: 2,
    });
    const workspaceId = resolveMillionSendEventWorkspace(matches);
    if (!workspaceId) return { matched: false };
    const actor = await transaction.actor.findFirst({
      where: { workspaceId, type: "SYSTEM", key: "system", userId: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!actor) fail("O ator de sistema do workspace não está configurado.", "MILLIONSEND_WEBHOOK_SYSTEM_ACTOR_MISSING", 503);
    const recorded = await getProspectingEmailService().event(transaction, {
      clientId: "millionsend-webhook",
      workspaceId,
      actorId: actor.id,
      scopes: ["EMAIL_EVENT_WRITE"],
    }, input);
    return { ...recorded, matched: true };
  }, { maxWait: 5_000, timeout: 10_000 });
}

export function createMillionSendWebhookService(options: Readonly<{
  environment?: WebhookEnvironment;
  recordEvent?: (input: MillionSendEventInput) => Promise<MillionSendEventResult>;
  now?: () => Date;
}> = {}) {
  const environment = options.environment ?? process.env;
  const now = options.now ?? (() => new Date());
  const recordEvent = options.recordEvent ?? recordMillionSendEvent;

  return Object.freeze({
    async ingest(input: Readonly<{ rawBody: string; id: string | null; timestamp: string | null; signature: string | null }>) {
      if (!input.id || !input.timestamp || !input.signature) fail("Cabeçalhos do webhook ausentes.", "MILLIONSEND_WEBHOOK_HEADERS_MISSING", 401);
      if (!/^\d{10,13}$/.test(input.timestamp)) fail("Timestamp do webhook inválido.", "MILLIONSEND_WEBHOOK_TIMESTAMP_INVALID", 401);
      const timestampMs = input.timestamp.length === 13 ? Number(input.timestamp) : Number(input.timestamp) * 1_000;
      if (!Number.isFinite(timestampMs) || Math.abs(now().getTime() - timestampMs) > 5 * 60_000) fail("Webhook fora da janela temporal.", "MILLIONSEND_WEBHOOK_EXPIRED", 401);
      const signingSecret = environment.MILLIONSEND_WEBHOOK_SECRET;
      if (!signingSecret) fail("O webhook da MillionSend não está configurado.", "MILLIONSEND_WEBHOOK_CONFIGURATION_INVALID", 503);
      const expected = createHmac("sha256", decodeSecret(signingSecret)).update(`${input.id}.${input.timestamp}.${input.rawBody}`).digest("base64");
      if (!validSignature(expected, input.signature)) fail("Assinatura do webhook inválida.", "MILLIONSEND_WEBHOOK_SIGNATURE_INVALID", 401);

      let decoded: unknown;
      try {
        decoded = JSON.parse(input.rawBody);
      } catch {
        fail("JSON do webhook inválido.", "MILLIONSEND_WEBHOOK_JSON_INVALID", 400);
      }
      const payload = webhookPayloadSchema.parse(decoded);
      const eventType = forwardedEvents[payload.type as keyof typeof forwardedEvents];
      if (!eventType) return { accepted: true, forwarded: false, reason: "EVENT_NOT_TRACKED" };
      const providerMessageId = payload.data.email_id ?? payload.data.id;
      if (!providerMessageId) fail("O evento não contém o ID da mensagem.", "MILLIONSEND_WEBHOOK_MESSAGE_ID_MISSING", 400);

      const recorded = await recordEvent({
        externalEventId: input.id,
        providerMessageId,
        type: eventType,
        occurredAt: payload.created_at,
        automaticReply: false,
        metadata: {},
      });
      if (!recorded.matched) return { accepted: true, forwarded: false, reason: "MESSAGE_NOT_TRACKED" };
      return { accepted: true, forwarded: true, type: eventType };
    },
  });
}
