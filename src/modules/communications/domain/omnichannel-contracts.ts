import { createHash } from "node:crypto";
import { z } from "zod";

import type {
  ConversationChannel,
  ConversationStatus,
  MessageStatus,
  PrivacyChannel,
} from "@/generated/prisma/client";
import { normalizePhone } from "@/modules/leads/domain/phone-normalizer";

export const OMNICHANNEL_CONTRACT_VERSION = "1.0";
export const OMNICHANNEL_BACKFILL_RULE_VERSION = "crm43-omnichannel-v1";
export const OMNICHANNEL_MAX_BODY_BYTES = 16 * 1024;
export const OMNICHANNEL_MAX_WEBHOOK_BYTES = 64 * 1024;
export const OMNICHANNEL_FIRST_RESPONSE_TARGET_SECONDS = 180;

export const supportedConversationChannels = [
  "INTERNAL_SIMULATOR",
  "WHATSAPP",
  "EMAIL",
  "PHONE",
  "SMS",
  "INSTAGRAM_MESSAGING",
] as const satisfies readonly ConversationChannel[];

export type SupportedConversationChannel = (typeof supportedConversationChannels)[number];

export type ChannelCapability = Readonly<{
  channel: SupportedConversationChannel;
  label: string;
  support: "LOCAL_ONLY" | "EXTERNAL_DEFERRED" | "FUTURE";
  inbound: boolean;
  outbound: boolean;
  text: boolean;
  template: boolean;
  mediaReference: boolean;
  callEvent: boolean;
  delivery: boolean;
  read: boolean;
  bounce: boolean;
  reply: boolean;
  threading: boolean;
  sendingWindow: string;
  consentRequired: boolean;
}>;

export const channelCapabilities: readonly ChannelCapability[] = Object.freeze([
  { channel: "INTERNAL_SIMULATOR", label: "Simulador interno", support: "LOCAL_ONLY", inbound: true, outbound: true, text: true, template: true, mediaReference: true, callEvent: true, delivery: true, read: true, bounce: true, reply: true, threading: true, sendingWindow: "Política local do workspace", consentRequired: true },
  { channel: "WHATSAPP", label: "WhatsApp", support: "LOCAL_ONLY", inbound: true, outbound: true, text: true, template: true, mediaReference: true, callEvent: false, delivery: true, read: true, bounce: false, reply: true, threading: true, sendingWindow: "24 horas após a última mensagem do contato; fora dela, somente template aprovado pelo provider", consentRequired: true },
  { channel: "EMAIL", label: "E-mail", support: "LOCAL_ONLY", inbound: true, outbound: true, text: true, template: true, mediaReference: true, callEvent: false, delivery: true, read: false, bounce: true, reply: true, threading: true, sendingWindow: "Sink local; provider e domínio externos adiados", consentRequired: true },
  { channel: "PHONE", label: "Telefonia", support: "EXTERNAL_DEFERRED", inbound: true, outbound: true, text: false, template: false, mediaReference: true, callEvent: true, delivery: false, read: false, bounce: false, reply: false, threading: false, sendingWindow: "Política local de horário", consentRequired: true },
  { channel: "SMS", label: "SMS", support: "FUTURE", inbound: true, outbound: true, text: true, template: true, mediaReference: false, callEvent: false, delivery: true, read: false, bounce: false, reply: true, threading: false, sendingWindow: "Provider futuro", consentRequired: true },
  { channel: "INSTAGRAM_MESSAGING", label: "Instagram", support: "FUTURE", inbound: true, outbound: true, text: true, template: false, mediaReference: true, callEvent: false, delivery: true, read: true, bounce: false, reply: true, threading: true, sendingWindow: "Provider futuro", consentRequired: true },
]);

export const inboxQuerySchema = z.object({
  conversationId: z.string().uuid().optional(),
  view: z.enum(["ALL", "MINE", "UNREAD", "OVERDUE", "WAITING_INTERNAL", "WAITING_CUSTOMER"]).default("ALL"),
  channels: z.array(z.enum(supportedConversationChannels)).default([]),
  priorities: z.array(z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"])).default([]),
  search: z.string().trim().max(120).default(""),
  cursor: z.string().datetime({ offset: true }).optional(),
  take: z.coerce.number().int().min(1).max(100).default(40),
}).strict();

export const localInboundSchema = z.object({
  externalEventId: z.string().trim().regex(/^[A-Za-z0-9_.:-]{8,160}$/),
  channel: z.enum(supportedConversationChannels),
  address: z.string().trim().min(3).max(320),
  body: z.string().trim().min(1).max(10_000),
  subject: z.string().trim().max(240).optional(),
  messageIdHeader: z.string().trim().max(255).optional(),
  inReplyToHeader: z.string().trim().max(255).nullable().optional(),
  referenceHeaders: z.array(z.string().trim().max(255)).max(20).default([]),
  occurredAt: z.string().datetime({ offset: true }),
  scenario: z.enum(["RECEIVED", "REPLY", "OPT_OUT"]).default("RECEIVED"),
}).strict();

export const composeMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1).max(10_000),
  subject: z.string().trim().max(240).nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(180),
  clientCorrelationId: z.string().trim().min(8).max(180),
  templateVersionId: z.string().uuid().nullable().optional(),
}).strict();

export const deliveryScenarioSchema = z.object({
  messageId: z.string().uuid(),
  scenario: z.enum(["ACCEPTED", "PROVIDER_ACCEPTED", "SENT", "DELIVERED", "READ", "REPLY", "TRANSIENT_FAILURE", "PERMANENT_FAILURE", "BOUNCED", "DELAY", "DEFERRED", "SOFT_BOUNCE", "HARD_BOUNCE", "COMPLAINT", "REJECTED", "UNSUBSCRIBED", "UNKNOWN_REVIEW"]),
  externalEventId: z.string().trim().regex(/^[A-Za-z0-9_.:-]{8,160}$/),
}).strict();

export const conversationCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("MARK_READ"), conversationId: z.string().uuid(), unread: z.boolean().default(false), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("RESOLVE"), conversationId: z.string().uuid(), reason: z.string().trim().min(3).max(500), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("REOPEN"), conversationId: z.string().uuid(), reason: z.string().trim().min(3).max(500), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("ARCHIVE"), conversationId: z.string().uuid(), reason: z.string().trim().min(3).max(500), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("CLAIM"), conversationId: z.string().uuid(), reason: z.string().trim().min(3).max(500), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("TRANSFER"), conversationId: z.string().uuid(), memberId: z.string().uuid().nullable(), queueId: z.string().uuid().nullable(), reason: z.string().trim().min(3).max(500), expectedRevision: z.number().int().positive() }).strict().superRefine((value, context) => { if (!value.memberId && !value.queueId) context.addIssue({ code: "custom", path: ["memberId"], message: "Informe responsável ou fila." }); }),
]);

export const templateInputSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9-]{2,80}$/),
  name: z.string().trim().min(3).max(120),
  channel: z.enum(supportedConversationChannels),
  category: z.string().trim().min(2).max(80),
  locale: z.string().trim().regex(/^[a-z]{2}-[A-Z]{2}$/).default("pt-BR"),
  bodyTemplate: z.string().trim().min(1).max(10_000),
  subjectTemplate: z.string().trim().max(240).nullable().optional(),
  variables: z.array(z.string().trim().regex(/^[a-z][a-zA-Z0-9_]{0,49}$/)).max(30),
  publish: z.boolean().default(false),
}).strict();

export function channelPrivacyChannel(channel: SupportedConversationChannel): PrivacyChannel {
  if (channel === "EMAIL") return "EMAIL";
  if (channel === "WHATSAPP") return "WHATSAPP";
  if (channel === "PHONE") return "PHONE";
  if (channel === "SMS") return "SMS";
  return "OTHER";
}

export function normalizeChannelAddress(channel: SupportedConversationChannel, address: string): Readonly<{ success: true; normalized: string; masked: string; hash: string }> | Readonly<{ success: false; code: "INVALID_ADDRESS" }> {
  const compact = address.trim();
  let normalized: string;
  if (channel === "EMAIL") {
    const parsed = z.string().email().max(320).safeParse(compact.toLowerCase());
    if (!parsed.success) return { success: false, code: "INVALID_ADDRESS" };
    normalized = parsed.data;
  } else if (["WHATSAPP", "PHONE", "SMS", "INTERNAL_SIMULATOR"].includes(channel)) {
    const phone = normalizePhone(compact);
    if (!phone.success) return { success: false, code: "INVALID_ADDRESS" };
    normalized = phone.normalizedPhone;
  } else {
    normalized = compact.toLowerCase();
    if (normalized.length < 3) return { success: false, code: "INVALID_ADDRESS" };
  }
  const hash = createHash("sha256").update(`${channel}:${normalized}`).digest("hex");
  const masked = channel === "EMAIL"
    ? normalized.replace(/^(.{1,2}).*(@.*)$/, "$1•••$2")
    : `${normalized.slice(0, Math.min(4, normalized.length))}••••${normalized.slice(-4)}`;
  return { success: true, normalized, masked, hash };
}

const statusRank: Readonly<Record<MessageStatus, number>> = {
  DRAFT: 0,
  BLOCKED_BY_POLICY: 1,
  QUEUED: 2,
  ACCEPTED_INTERNAL: 3,
  PROVIDER_ACCEPTED: 4,
  SENT: 5,
  DELIVERED: 6,
  READ: 7,
  REPLIED: 8,
  RECEIVED: 8,
  DEFERRED: 4,
  SOFT_BOUNCE: 4,
  HARD_BOUNCE: 9,
  COMPLAINT: 10,
  REJECTED: 9,
  UNSUBSCRIBED: 10,
  UNKNOWN_REVIEW: 0,
  FAILED_TRANSIENT: 2,
  FAILED_PERMANENT: 9,
  BOUNCED: 9,
  CANCELLED: 9,
  FAILED: 9,
};

const terminalStatuses = new Set<MessageStatus>(["BLOCKED_BY_POLICY", "FAILED_PERMANENT", "BOUNCED", "HARD_BOUNCE", "COMPLAINT", "REJECTED", "UNSUBSCRIBED", "CANCELLED", "FAILED"]);

export function shouldProjectMessageStatus(current: MessageStatus, incoming: MessageStatus): boolean {
  if (current === incoming) return false;
  if (terminalStatuses.has(current)) return false;
  if (incoming === "FAILED_TRANSIENT") return !["DELIVERED", "READ", "REPLIED", "RECEIVED"].includes(current);
  return statusRank[incoming] >= statusRank[current];
}

export function nextConversationStatus(direction: "INBOUND" | "OUTBOUND" | "INTERNAL" | "SYSTEM", current: ConversationStatus): ConversationStatus {
  if (["CLOSED", "ARCHIVED"].includes(current)) return current;
  return direction === "INBOUND" ? "PENDING_INTERNAL" : direction === "OUTBOUND" ? "WAITING_CUSTOMER" : current;
}

export function escapeTemplateValue(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function renderMessageTemplate(template: string, allowedVariables: readonly string[], values: Readonly<Record<string, string>>): string {
  const allowed = new Set(allowedVariables);
  const rendered = template.replace(/\{\{\s*([a-z][a-zA-Z0-9_]*)\s*\}\}/g, (_match, variable: string) => {
    if (!allowed.has(variable) || !(variable in values)) throw new Error(`TEMPLATE_VARIABLE_MISSING:${variable}`);
    return escapeTemplateValue(values[variable]!);
  });
  if (Buffer.byteLength(rendered, "utf8") > OMNICHANNEL_MAX_BODY_BYTES) throw new Error("TEMPLATE_OUTPUT_TOO_LARGE");
  return rendered;
}

export function conversationSlaState(input: Readonly<{ status: ConversationStatus; waitingSince: Date | null; now: Date }>) {
  if (input.status !== "PENDING_INTERNAL" || !input.waitingSince) return { state: "NOT_RUNNING" as const, elapsedSeconds: null };
  const elapsedSeconds = Math.max(0, Math.floor((input.now.getTime() - input.waitingSince.getTime()) / 1_000));
  return { state: elapsedSeconds > OMNICHANNEL_FIRST_RESPONSE_TARGET_SECONDS ? "OVERDUE" as const : "RUNNING" as const, elapsedSeconds };
}
