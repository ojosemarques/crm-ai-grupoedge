import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { MessageStatus } from "@/generated/prisma/client";

export const WHATSAPP_PROVIDER_KEY = "WHATSAPP_CLOUD_API";
export const WHATSAPP_LOCAL_PROVIDER_KEY = "WHATSAPP_LOCAL_SIMULATOR";
export const WHATSAPP_ADAPTER_KEY = "whatsapp-cloud-api-v1";
export const WHATSAPP_CONTRACT_VERSION = "whatsapp-cloud-api/1.0";
export const WHATSAPP_DEFAULT_GRAPH_API_VERSION = "v26.0";
export const WHATSAPP_GRAPH_API_VERSION_ALLOWLIST = ["v26.0", "v25.0"] as const;
export const WHATSAPP_CUSTOMER_SERVICE_WINDOW_SECONDS = 24 * 60 * 60;
export const WHATSAPP_MAX_WEBHOOK_BYTES = 256 * 1024;

export const WHATSAPP_SECRET_REFERENCES = Object.freeze({
  accessToken: { alias: "access-token", referenceKey: "WHATSAPP_ACCESS_TOKEN" },
  appSecret: { alias: "app-secret", referenceKey: "WHATSAPP_APP_SECRET" },
  verifyToken: { alias: "verify-token", referenceKey: "WHATSAPP_VERIFY_TOKEN" },
});

const externalIdSchema = z.string().trim().regex(/^\d{5,40}$/);
const eventIdSchema = z.string().trim().regex(/^[A-Za-z0-9_.:-]{6,255}$/);

export const whatsAppConfigurationSchema = z.object({
  graphApiVersion: z.enum(WHATSAPP_GRAPH_API_VERSION_ALLOWLIST),
  businessAccountId: externalIdSchema.nullable(),
  businessPortfolioId: externalIdSchema.nullable(),
  phoneNumberId: externalIdSchema.nullable(),
  displayPhoneMasked: z.string().trim().min(4).max(40).nullable(),
  timeZone: z.literal("America/Sao_Paulo"),
  locale: z.literal("pt-BR"),
  operatingMode: z.enum(["LOCAL_SIMULATOR", "EXTERNAL_DISABLED", "PAUSED"]),
}).strict();

export const whatsAppConfigureLocalSchema = z.object({
  displayName: z.string().trim().min(3).max(100).default("WhatsApp Cloud API"),
  revision: z.number().int().positive().optional(),
  graphApiVersion: z.enum(WHATSAPP_GRAPH_API_VERSION_ALLOWLIST).default(WHATSAPP_DEFAULT_GRAPH_API_VERSION),
}).strict();

export const whatsAppLocalInboundSchema = z.object({
  externalEventId: eventIdSchema,
  address: z.string().trim().min(8).max(32),
  body: z.string().trim().min(1).max(10_000),
  occurredAt: z.string().datetime({ offset: true }),
  scenario: z.enum(["RECEIVED", "REPLY", "OPT_OUT"]).default("RECEIVED"),
}).strict();

export const whatsAppStatusSimulationSchema = z.object({
  messageId: z.string().uuid(),
  externalEventId: eventIdSchema,
  status: z.enum(["sent", "delivered", "read", "failed", "unknown"]),
  occurredAt: z.string().datetime({ offset: true }),
  transient: z.boolean().default(false),
}).strict();

const metaMessageSchema = z.object({
  from: z.string().trim().min(3).max(64),
  id: eventIdSchema,
  timestamp: z.string().regex(/^\d{9,14}$/),
  type: z.string().trim().min(1).max(40),
  context: z.object({ id: eventIdSchema.optional(), from: z.string().optional() }).passthrough().optional(),
  text: z.object({ body: z.string().max(10_000) }).passthrough().optional(),
  button: z.object({ text: z.string().max(1_000).optional(), payload: z.string().max(1_000).optional() }).passthrough().optional(),
  interactive: z.object({
    type: z.string().optional(),
    button_reply: z.object({ id: z.string().max(255), title: z.string().max(1_000) }).passthrough().optional(),
    list_reply: z.object({ id: z.string().max(255), title: z.string().max(1_000), description: z.string().max(1_000).optional() }).passthrough().optional(),
  }).passthrough().optional(),
  image: z.object({ id: eventIdSchema, mime_type: z.string().max(160).optional(), sha256: z.string().max(160).optional(), caption: z.string().max(10_000).optional() }).passthrough().optional(),
  audio: z.object({ id: eventIdSchema, mime_type: z.string().max(160).optional(), sha256: z.string().max(160).optional() }).passthrough().optional(),
  video: z.object({ id: eventIdSchema, mime_type: z.string().max(160).optional(), sha256: z.string().max(160).optional(), caption: z.string().max(10_000).optional() }).passthrough().optional(),
  document: z.object({ id: eventIdSchema, mime_type: z.string().max(160).optional(), sha256: z.string().max(160).optional(), filename: z.string().max(255).optional(), caption: z.string().max(10_000).optional() }).passthrough().optional(),
  sticker: z.object({ id: eventIdSchema, mime_type: z.string().max(160).optional(), sha256: z.string().max(160).optional() }).passthrough().optional(),
  location: z.object({ latitude: z.number().finite(), longitude: z.number().finite(), name: z.string().max(255).optional(), address: z.string().max(500).optional() }).passthrough().optional(),
  contacts: z.array(z.object({ name: z.object({ formatted_name: z.string().max(255).optional() }).passthrough().optional() }).passthrough()).max(20).optional(),
}).passthrough();

const metaStatusSchema = z.object({
  id: eventIdSchema,
  status: z.string().trim().min(1).max(40),
  timestamp: z.string().regex(/^\d{9,14}$/),
  recipient_id: z.string().trim().min(3).max(64),
  errors: z.array(z.object({ code: z.number().int().optional(), title: z.string().max(500).optional(), message: z.string().max(1_000).optional() }).passthrough()).max(20).optional(),
}).passthrough();

export const whatsAppWebhookPayloadSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({
    id: externalIdSchema,
    changes: z.array(z.object({
      field: z.literal("messages"),
      value: z.object({
        messaging_product: z.literal("whatsapp"),
        metadata: z.object({ display_phone_number: z.string().max(64).optional(), phone_number_id: externalIdSchema }).passthrough(),
        contacts: z.array(z.object({ wa_id: z.string().max(64), profile: z.object({ name: z.string().max(255) }).passthrough().optional() }).passthrough()).max(100).optional(),
        messages: z.array(metaMessageSchema).max(100).optional(),
        statuses: z.array(metaStatusSchema).max(100).optional(),
        errors: z.array(z.unknown()).max(100).optional(),
      }).passthrough(),
    }).passthrough()).max(100),
  }).passthrough()).max(100),
}).passthrough();

export type WhatsAppConfiguration = z.output<typeof whatsAppConfigurationSchema>;

export type NormalizedWhatsAppInbound = Readonly<{
  kind: "MESSAGE";
  eventId: string;
  phoneNumberId: string;
  businessAccountId: string;
  from: string;
  occurredAt: Date;
  messageType: "TEXT" | "MEDIA_REFERENCE";
  body: string;
  replyToExternalMessageId: string | null;
  optOut: boolean;
  media: null | Readonly<{ providerMediaId: string; providerMimeType: string | null; contentHash: string | null; fileName: string | null }>;
  reviewReason: string | null;
}>;

export type NormalizedWhatsAppStatus = Readonly<{
  kind: "STATUS";
  eventId: string;
  phoneNumberId: string;
  businessAccountId: string;
  externalMessageId: string;
  recipient: string;
  occurredAt: Date;
  status: MessageStatus | null;
  providerStatus: string;
  transient: boolean;
  reviewReason: string | null;
}>;

export type NormalizedWhatsAppEvent = NormalizedWhatsAppInbound | NormalizedWhatsAppStatus;

const serializedWhatsAppInboundSchema = z.object({
  kind: z.literal("MESSAGE"),
  eventId: eventIdSchema,
  phoneNumberId: externalIdSchema,
  businessAccountId: externalIdSchema,
  from: z.string().trim().min(3).max(64),
  occurredAt: z.string().datetime({ offset: true }),
  messageType: z.enum(["TEXT", "MEDIA_REFERENCE"]),
  body: z.string().max(10_000),
  replyToExternalMessageId: eventIdSchema.nullable(),
  optOut: z.boolean(),
  media: z.object({
    providerMediaId: eventIdSchema,
    providerMimeType: z.string().max(160).nullable(),
    contentHash: z.string().max(160).nullable(),
    fileName: z.string().max(255).nullable(),
  }).strict().nullable(),
  reviewReason: z.string().max(255).nullable(),
}).strict();

const serializedWhatsAppStatusSchema = z.object({
  kind: z.literal("STATUS"),
  eventId: eventIdSchema,
  phoneNumberId: externalIdSchema,
  businessAccountId: externalIdSchema,
  externalMessageId: eventIdSchema,
  recipient: z.string().trim().min(3).max(64),
  occurredAt: z.string().datetime({ offset: true }),
  status: z.enum(["SENT", "DELIVERED", "READ", "FAILED_TRANSIENT", "FAILED_PERMANENT"]).nullable(),
  providerStatus: z.string().trim().min(1).max(40),
  transient: z.boolean(),
  reviewReason: z.string().max(255).nullable(),
}).strict();

export const serializedWhatsAppEventSchema = z.discriminatedUnion("kind", [
  serializedWhatsAppInboundSchema,
  serializedWhatsAppStatusSchema,
]);

export function deserializeWhatsAppEvent(input: unknown): NormalizedWhatsAppEvent {
  const event = serializedWhatsAppEventSchema.parse(input);
  return { ...event, occurredAt: new Date(event.occurredAt) };
}

function unixSeconds(value: string): Date {
  const seconds = Number.parseInt(value, 10);
  const date = new Date(seconds * 1_000);
  if (!Number.isFinite(seconds) || Number.isNaN(date.getTime())) throw new Error("WHATSAPP_TIMESTAMP_INVALID");
  return date;
}

export function isWhatsAppOptOut(body: string): boolean {
  const normalized = body.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[.!?]+$/g, "");
  return new Set(["sair", "stop", "parar", "cancelar", "nao quero", "nao me contate", "remover meu numero"]).has(normalized);
}

function normalizeMessageBody(message: z.output<typeof metaMessageSchema>): { body: string; type: "TEXT" | "MEDIA_REFERENCE"; media: NormalizedWhatsAppInbound["media"]; reviewReason: string | null } {
  if (message.type === "text" && message.text) return { body: message.text.body, type: "TEXT", media: null, reviewReason: null };
  if (message.type === "button" && message.button) return { body: message.button.text ?? message.button.payload ?? "Resposta por botão", type: "TEXT", media: null, reviewReason: null };
  if (message.type === "interactive" && message.interactive) {
    const reply = message.interactive.button_reply ?? message.interactive.list_reply;
    return { body: reply?.title ?? "Resposta interativa", type: "TEXT", media: null, reviewReason: reply ? null : "INTERACTIVE_VARIANT_UNKNOWN" };
  }
  const media = message.image ?? message.audio ?? message.video ?? message.document ?? message.sticker;
  if (media) {
    const candidate = media as Readonly<Record<string, unknown>> & Readonly<{ id: string }>;
    return {
      body: typeof candidate.caption === "string" && candidate.caption ? candidate.caption : `[${message.type} recebido]`,
      type: "MEDIA_REFERENCE",
      media: {
        providerMediaId: candidate.id,
        providerMimeType: typeof candidate.mime_type === "string" ? candidate.mime_type : null,
        contentHash: typeof candidate.sha256 === "string" ? candidate.sha256 : null,
        fileName: typeof candidate.filename === "string" ? candidate.filename : null,
      },
      reviewReason: null,
    };
  }
  if (message.type === "location" && message.location) return { body: message.location.name ?? message.location.address ?? "Localização compartilhada", type: "TEXT", media: null, reviewReason: null };
  if (message.type === "contacts" && message.contacts) return { body: `${message.contacts.length} contato(s) compartilhado(s)`, type: "TEXT", media: null, reviewReason: null };
  return { body: `[conteúdo ${message.type} requer revisão]`, type: "TEXT", media: null, reviewReason: `MESSAGE_TYPE_UNKNOWN:${message.type}` };
}

export function normalizeWhatsAppWebhook(input: unknown): readonly NormalizedWhatsAppEvent[] {
  const payload = whatsAppWebhookPayloadSchema.parse(input);
  const events: NormalizedWhatsAppEvent[] = [];
  for (const entry of payload.entry) for (const change of entry.changes) {
    const phoneNumberId = change.value.metadata.phone_number_id;
    for (const message of change.value.messages ?? []) {
      const normalized = normalizeMessageBody(message);
      events.push({ kind: "MESSAGE", eventId: message.id, phoneNumberId, businessAccountId: entry.id, from: message.from, occurredAt: unixSeconds(message.timestamp), messageType: normalized.type, body: normalized.body, replyToExternalMessageId: message.context?.id ?? null, optOut: isWhatsAppOptOut(normalized.body), media: normalized.media, reviewReason: normalized.reviewReason });
    }
    for (const status of change.value.statuses ?? []) {
      const mapped = mapWhatsAppProviderStatus(status.status, Boolean(status.errors?.length));
      events.push({ kind: "STATUS", eventId: `${status.id}:${status.status}:${status.timestamp}`, phoneNumberId, businessAccountId: entry.id, externalMessageId: status.id, recipient: status.recipient_id, occurredAt: unixSeconds(status.timestamp), status: mapped.status, providerStatus: status.status, transient: mapped.transient, reviewReason: mapped.reviewReason });
    }
  }
  return events;
}

export function mapWhatsAppProviderStatus(providerStatus: string, hasErrors = false): Readonly<{ status: MessageStatus | null; transient: boolean; reviewReason: string | null }> {
  if (providerStatus === "sent") return { status: "SENT", transient: false, reviewReason: null };
  if (providerStatus === "delivered") return { status: "DELIVERED", transient: false, reviewReason: null };
  if (providerStatus === "read") return { status: "READ", transient: false, reviewReason: null };
  if (providerStatus === "failed") return { status: hasErrors ? "FAILED_PERMANENT" : "FAILED_TRANSIENT", transient: !hasErrors, reviewReason: null };
  return { status: null, transient: false, reviewReason: `STATUS_UNKNOWN:${providerStatus}` };
}

export function evaluateWhatsAppServiceWindow(lastCustomerInboundAt: Date | null, now: Date) {
  if (!lastCustomerInboundAt) return { open: false, expiresAt: null, remainingSeconds: 0 } as const;
  const expiresAt = new Date(lastCustomerInboundAt.getTime() + WHATSAPP_CUSTOMER_SERVICE_WINDOW_SECONDS * 1_000);
  return { open: now.getTime() <= expiresAt.getTime(), expiresAt, remainingSeconds: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1_000)) } as const;
}

export function evaluateWhatsAppOutboundPolicy(input: Readonly<{ lastCustomerInboundAt: Date | null; now: Date; hasTemplate: boolean; providerTemplateStatus: "APPROVED" | "LOCAL_ONLY" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | "UNKNOWN" | null; optOut: boolean }>) {
  if (input.optOut) return { allowed: false, code: "WHATSAPP_OPT_OUT", reason: "O contato optou por não receber mensagens." } as const;
  const window = evaluateWhatsAppServiceWindow(input.lastCustomerInboundAt, input.now);
  if (window.open && !input.hasTemplate) return { allowed: true, code: "FREE_FORM_WINDOW_OPEN", reason: "Mensagem livre dentro da janela de atendimento de 24 horas.", window } as const;
  if (!input.hasTemplate) return { allowed: false, code: "WHATSAPP_TEMPLATE_REQUIRED", reason: "Fora da janela de 24 horas, apenas template aprovado pelo provider é elegível.", window } as const;
  if (input.providerTemplateStatus !== "APPROVED") return { allowed: false, code: "WHATSAPP_TEMPLATE_NOT_PROVIDER_APPROVED", reason: "Template local não equivale a template aprovado pelo provider.", window } as const;
  return { allowed: true, code: "PROVIDER_TEMPLATE_APPROVED", reason: "Template aprovado pelo provider elegível para iniciar a conversa.", window } as const;
}

export function verifyWhatsAppSignature(rawBody: Buffer, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const suppliedHex = signatureHeader.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(suppliedHex)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const supplied = Buffer.from(suppliedHex, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function verifyWhatsAppChallengeToken(supplied: string, expected: string): boolean {
  const suppliedHash = createHash("sha256").update(supplied).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

export function whatsAppWebhookKey(workspaceId: string): string {
  return `wa_${createHash("sha256").update(`whatsapp-webhook:${workspaceId}`).digest("hex").slice(0, 32)}`;
}
