import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { MessageStatus } from "@/generated/prisma/client";

export const EMAIL_PROVIDER_KEY = "EMAIL_LOCAL_SINK";
export const EMAIL_ADAPTER_KEY = "email-channel-v1";
export const EMAIL_CONTRACT_VERSION = "email-channel/1.0";
export const EMAIL_MAX_WEBHOOK_BYTES = 256 * 1024;
export const EMAIL_MAX_BODY_BYTES = 64 * 1024;
export const EMAIL_MAX_MIME_PARTS = 40;
export const EMAIL_MAX_MIME_DEPTH = 8;
export const EMAIL_MAX_RECIPIENTS = 20;
export const EMAIL_MAX_REFERENCES = 20;

const emailAddress = z.string().trim().toLowerCase().email().max(254);
const opaqueEventId = z.string().trim().regex(/^[A-Za-z0-9_.:@<>+-]{6,255}$/);

export const emailConfigureLocalSchema = z.object({
  displayName: z.string().trim().min(2).max(100).default("Grupo Edge CRM"),
  senderAddress: emailAddress.default("crm@demo.politizai.local"),
  replyTo: emailAddress.nullable().optional(),
  revision: z.number().int().positive().optional(),
}).strict();

export const emailLocalInboundSchema = z.object({
  externalEventId: opaqueEventId,
  from: emailAddress,
  subject: z.string().trim().min(1).max(240),
  text: z.string().trim().min(1).max(50_000),
  messageId: opaqueEventId,
  inReplyTo: opaqueEventId.nullable().optional(),
  references: z.array(opaqueEventId).max(EMAIL_MAX_REFERENCES).default([]),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();

export const emailLocalStatusSchema = z.object({
  messageId: z.string().uuid(),
  externalEventId: opaqueEventId,
  status: z.enum(["PROVIDER_ACCEPTED", "SENT", "DELIVERED", "DEFERRED", "SOFT_BOUNCE", "HARD_BOUNCE", "COMPLAINT", "REJECTED", "REPLIED", "UNSUBSCRIBED", "UNKNOWN_REVIEW"]),
  occurredAt: z.string().datetime({ offset: true }),
  diagnosticCode: z.string().trim().max(240).nullable().optional(),
}).strict();

export const emailAttachmentSchema = z.object({
  opaqueReference: z.string().trim().regex(/^[A-Za-z0-9_.:/-]{8,300}$/),
  fileName: z.string().trim().min(1).max(180),
  declaredMimeType: z.string().trim().min(3).max(120),
  observedMimeType: z.string().trim().min(3).max(120).nullable().optional(),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type EmailLocalStatus = z.output<typeof emailLocalStatusSchema>["status"];

export function normalizeEmailAddress(value: string) {
  const parsed = emailAddress.safeParse(value);
  if (!parsed.success) return { success: false as const, code: "EMAIL_ADDRESS_INVALID" as const };
  const normalized = parsed.data;
  const [local, domain] = normalized.split("@");
  return {
    success: true as const,
    normalized,
    domain: domain!,
    masked: `${local!.slice(0, 2)}•••@${domain}`,
    hash: createHash("sha256").update(`EMAIL:${normalized}`).digest("hex"),
  };
}

export function assertSafeHeader(value: string, field = "header") {
  if (/\r|\n|\0/.test(value)) throw new Error(`EMAIL_HEADER_INJECTION:${field}`);
  return value.trim();
}

export function normalizeMessageId(value: string) {
  const safe = assertSafeHeader(value, "message-id");
  if (!/^<[^<>\s@]+@[^<>\s@]+>$/.test(safe)) throw new Error("EMAIL_MESSAGE_ID_INVALID");
  return safe.toLowerCase();
}

export function createStableMessageId(workspaceId: string, messageId: string, domain: string) {
  const safeDomain = domain.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(safeDomain)) throw new Error("EMAIL_DOMAIN_INVALID");
  const digest = createHash("sha256").update(`${workspaceId}:${messageId}`).digest("hex").slice(0, 32);
  return `<${digest}@${safeDomain}>`;
}

export function normalizeReferenceChain(values: readonly string[]) {
  const unique = [...new Set(values.map(normalizeMessageId))];
  return unique.slice(-EMAIL_MAX_REFERENCES);
}

export function resolveEmailThread(input: Readonly<{
  inReplyTo?: string | null;
  references?: readonly string[];
  candidates: ReadonlyArray<Readonly<{ conversationId: string; messageIdHeader: string }>>;
}>) {
  const keys = normalizeReferenceChain([...(input.references ?? []), ...(input.inReplyTo ? [input.inReplyTo] : [])]);
  const matches = new Set(input.candidates.filter((candidate) => keys.includes(normalizeMessageId(candidate.messageIdHeader))).map((candidate) => candidate.conversationId));
  if (matches.size === 1) return { outcome: "MATCHED" as const, conversationId: [...matches][0]! };
  if (matches.size > 1) return { outcome: "REVIEW_REQUIRED" as const, reason: "MULTIPLE_THREAD_MATCHES" as const, conversationId: null };
  return { outcome: "REVIEW_REQUIRED" as const, reason: "THREAD_NOT_FOUND" as const, conversationId: null };
}

export function sanitizeEmailHtml(value: string) {
  if (Buffer.byteLength(value, "utf8") > EMAIL_MAX_BODY_BYTES) throw new Error("EMAIL_HTML_TOO_LARGE");
  return value
    .replace(/<(script|style|iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form)[^>]*\/?>/gi, "")
    .replace(/\s(on\w+|srcdoc)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*(javascript:|data:|https?:\/\/)[\s\S]*?\2/gi, '$1="#blocked-remote-content"');
}

export function validateMimeLimits(input: Readonly<{ bytes: number; parts: number; depth: number }>) {
  if (input.bytes > EMAIL_MAX_WEBHOOK_BYTES) throw new Error("EMAIL_MIME_TOO_LARGE");
  if (input.parts > EMAIL_MAX_MIME_PARTS) throw new Error("EMAIL_MIME_TOO_MANY_PARTS");
  if (input.depth > EMAIL_MAX_MIME_DEPTH) throw new Error("EMAIL_MIME_TOO_DEEP");
  return true;
}

export function verifyEmailWebhookSignature(rawBody: Buffer, supplied: string | null, secret: string) {
  if (!supplied?.startsWith("sha256=")) return false;
  const value = supplied.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(value)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(value, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

const emailStatusRank: Readonly<Partial<Record<MessageStatus, number>>> = {
  QUEUED: 1, PROVIDER_ACCEPTED: 2, SENT: 3, DEFERRED: 3, SOFT_BOUNCE: 3,
  DELIVERED: 4, REPLIED: 5, HARD_BOUNCE: 6, COMPLAINT: 7, REJECTED: 6,
  UNSUBSCRIBED: 7, UNKNOWN_REVIEW: 0,
};
const emailTerminal = new Set<MessageStatus>(["HARD_BOUNCE", "COMPLAINT", "REJECTED", "UNSUBSCRIBED", "CANCELLED"]);

export function shouldProjectEmailStatus(current: MessageStatus, incoming: MessageStatus) {
  if (current === incoming || emailTerminal.has(current)) return false;
  if (incoming === "DEFERRED" || incoming === "SOFT_BOUNCE") return !["DELIVERED", "REPLIED"].includes(current);
  return (emailStatusRank[incoming] ?? 0) >= (emailStatusRank[current] ?? 0);
}

export function parseDeliveryStatusNotification(value: string) {
  if (Buffer.byteLength(value, "utf8") > EMAIL_MAX_BODY_BYTES) throw new Error("EMAIL_DSN_TOO_LARGE");
  const field = (name: string) => value.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? null;
  const action = field("Action")?.toLowerCase() ?? null;
  return {
    finalRecipient: field("Final-Recipient")?.replace(/^rfc822;\s*/i, "") ?? null,
    action,
    statusCode: field("Status"),
    diagnosticCode: field("Diagnostic-Code")?.slice(0, 240) ?? null,
    mappedStatus: action === "failed" ? "HARD_BOUNCE" as const : action === "delayed" ? "DEFERRED" as const : action === "delivered" ? "DELIVERED" as const : "UNKNOWN_REVIEW" as const,
  };
}

const unsubscribePayload = z.object({ workspaceId: z.string().uuid(), contactPointHash: z.string().regex(/^[a-f0-9]{64}$/), purposeKey: z.string().min(2).max(80), expiresAt: z.number().int().positive() }).strict();

export function createUnsubscribeToken(payload: z.input<typeof unsubscribePayload>, secret: string) {
  const body = Buffer.from(JSON.stringify(unsubscribePayload.parse(payload))).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyUnsubscribeToken(token: string, secret: string, now = new Date()) {
  const [body, supplied] = token.split(".");
  if (!body || !supplied) throw new Error("EMAIL_UNSUBSCRIBE_TOKEN_INVALID");
  const expected = createHmac("sha256", secret).update(body).digest();
  const received = Buffer.from(supplied, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("EMAIL_UNSUBSCRIBE_TOKEN_INVALID");
  const payload = unsubscribePayload.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  if (payload.expiresAt < Math.floor(now.getTime() / 1_000)) throw new Error("EMAIL_UNSUBSCRIBE_TOKEN_EXPIRED");
  return payload;
}

export function emailWebhookKey(workspaceId: string) {
  return `email_${createHash("sha256").update(`email-webhook:${workspaceId}`).digest("hex").slice(0, 32)}`;
}
