import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { normalizePhone } from "@/modules/leads/domain/phone-normalizer";
import { telephonyScenarios } from "@/modules/integrations/domain/telephony-shared-contracts";

export { telephonyScenarios } from "@/modules/integrations/domain/telephony-shared-contracts";
export type { TelephonyScenario } from "@/modules/integrations/domain/telephony-shared-contracts";

export const TELEPHONY_CONNECTION_KEY = "telephony-local-simulator";
export const TELEPHONY_PROVIDER_KEY = "TELEPHONY_LOCAL_SIMULATOR";
export const TELEPHONY_ADAPTER_KEY = "telephony-channel-v1";
export const TELEPHONY_CONTRACT_VERSION = "telephony-channel/1.0";
export const TELEPHONY_SIMULATION_LABEL = "Telefonia local simulada; nenhuma chamada, gravação ou transcrição saiu deste ambiente.";
export const TELEPHONY_MAX_CALLBACK_BYTES = 64 * 1024;
export const TELEPHONY_JOB_MAX_ATTEMPTS = 3;

const uuid = z.string().uuid();
const opaqueKey = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9:._-]+$/);

export const telephonyStartCallSchema = z.object({
  leadId: uuid.optional(),
  contactId: uuid.optional(),
  accountId: uuid.optional(),
  opportunityId: uuid.optional(),
  meetingId: uuid.optional(),
  scenario: z.enum(telephonyScenarios).default("ANSWERED_COMPLETED"),
  idempotencyKey: opaqueKey,
  correlationId: opaqueKey,
}).strict().refine((value) => Boolean(value.leadId || value.contactId || value.accountId || value.opportunityId), {
  message: "Informe lead, contato, conta ou oportunidade.",
});

export const telephonyDispositionSchema = z.object({
  callId: uuid,
  disposition: z.enum(["CONNECTED", "NO_ANSWER", "BUSY", "WRONG_NUMBER", "VOICEMAIL", "CALLBACK_REQUESTED", "MEETING_SCHEDULED", "NO_INTEREST", "OTHER"]),
  note: z.string().trim().max(2_000).nullable().optional(),
  nextAction: z.object({
    title: z.string().trim().min(3).max(180),
    dueAt: z.coerce.date(),
  }).strict().nullable().optional(),
  expectedRevision: z.number().int().positive(),
}).strict().superRefine((value, context) => {
  if (value.disposition === "OTHER" && !value.note?.trim()) {
    context.addIssue({ code: "custom", path: ["note"], message: "Outro resultado exige observação." });
  }
  if (value.disposition === "CALLBACK_REQUESTED" && !value.nextAction) {
    context.addIssue({ code: "custom", path: ["nextAction"], message: "Retorno solicitado exige próxima ação." });
  }
});

export const telephonyConfigureSchema = z.object({
  revision: z.number().int().positive().optional(),
  originatorLabel: z.string().trim().min(3).max(120),
  contactWindowStartMinute: z.number().int().min(0).max(1_439),
  contactWindowEndMinute: z.number().int().min(1).max(1_440),
  contactWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
}).strict().refine((value) => value.contactWindowStartMinute < value.contactWindowEndMinute, {
  path: ["contactWindowEndMinute"], message: "O fim da janela deve ser posterior ao início.",
});

export const telephonyCallbackSchema = z.object({
  eventId: opaqueKey,
  callId: uuid,
  status: z.enum(["QUEUED", "INITIATED", "RINGING", "ANSWERED", "COMPLETED", "BUSY", "NO_ANSWER", "CANCELLED", "FAILED", "VOICEMAIL"]),
  occurredAt: z.coerce.date(),
  sequence: z.number().int().positive(),
  reasonCode: z.string().trim().min(1).max(120).nullable().optional(),
  leg: z.object({
    externalLegId: opaqueKey,
    role: z.enum(["CALLER", "CALLEE", "AGENT", "CUSTOMER", "TRANSFER_SOURCE", "TRANSFER_TARGET"]),
    sequence: z.number().int().positive(),
  }).strict().nullable().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}).strict();

export type TelephonyCallback = z.infer<typeof telephonyCallbackSchema>;

const safeMetadataKeys = new Set(["scenario", "attempt", "transfer", "timeoutMs", "simulated"]);

export function sanitizeTelephonyMetadata(input: Record<string, string | number | boolean | null> | undefined) {
  if (!input) return undefined;
  return Object.fromEntries(Object.entries(input).filter(([key]) => safeMetadataKeys.has(key)));
}

export function normalizeTelephonyAddress(input: string) {
  const value = input.trim();
  const normalized = normalizePhone(value);
  if (!normalized.success) {
    return { success: false as const, reasonCode: normalized.code, masked: "Número sob revisão", hash: sha256(value) };
  }
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized.normalizedPhone)) {
    return { success: false as const, reasonCode: "PHONE_E164_UNRELIABLE", masked: "Número sob revisão", hash: sha256(value) };
  }
  const verifiedCountryCode = normalized.normalizedPhone.startsWith("+55") ? "55"
    : normalized.normalizedPhone.startsWith("+1") ? "1"
    : normalized.normalizedPhone.startsWith("+351") ? "351"
    : normalized.normalizedPhone.startsWith("+44") ? "44"
    : null;
  if (!verifiedCountryCode) {
    return { success: false as const, reasonCode: "PHONE_COUNTRY_CODE_UNVERIFIED", masked: maskPhone(normalized.normalizedPhone), hash: sha256(normalized.normalizedPhone) };
  }
  return {
    success: true as const,
    e164: normalized.normalizedPhone,
    countryCode: verifiedCountryCode,
    masked: maskPhone(normalized.normalizedPhone),
    hash: sha256(normalized.normalizedPhone),
  };
}

export function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length < 6 ? "••••" : `+${digits.slice(0, 2)} ••••••${digits.slice(-4)}`;
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function callbackKey(workspaceId: string) {
  return sha256(`politizai-telephony-local-callback:${workspaceId}:v1`);
}

export function signLocalTelephonyCallback(workspaceId: string, rawBody: Buffer) {
  return createHmac("sha256", callbackKey(workspaceId)).update(rawBody).digest("hex");
}

export function verifyLocalTelephonyCallback(workspaceId: string, rawBody: Buffer, signature: string | null) {
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signLocalTelephonyCallback(workspaceId, rawBody), "hex");
  const supplied = Buffer.from(signature, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export const telephonyStatusRank = Object.freeze({
  QUEUED: 10,
  INITIATED: 20,
  RINGING: 30,
  ANSWERED: 40,
  COMPLETED: 50,
  BUSY: 50,
  NO_ANSWER: 50,
  CANCELLED: 50,
  FAILED: 50,
  VOICEMAIL: 50,
  REVIEW_REQUIRED: 0,
} satisfies Record<string, number>);

export function assessTelephonyEvent(input: Readonly<{
  currentStatus: keyof typeof telephonyStatusRank;
  currentSequence: number;
  incomingStatus: keyof typeof telephonyStatusRank;
  incomingSequence: number;
  latestOccurredAt?: Date | null;
  occurredAt: Date;
}>) {
  if (input.incomingSequence <= input.currentSequence) return { project: false as const, reasonCode: "DUPLICATE_OR_OUT_OF_ORDER_SEQUENCE" };
  if (input.latestOccurredAt && input.occurredAt < input.latestOccurredAt) return { project: false as const, reasonCode: "LATE_EVENT_TIMESTAMP" };
  if (telephonyStatusRank[input.incomingStatus] < telephonyStatusRank[input.currentStatus]) return { project: false as const, reasonCode: "STATUS_REGRESSION" };
  return { project: true as const, reasonCode: null };
}

export function isWithinTelephonyContactWindow(input: Readonly<{ now: Date; timeZone: string; startMinute: number; endMinute: number; weekdays: readonly number[] }>) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(input.now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = weekdays[part("weekday")];
  const minute = Number(part("hour")) * 60 + Number(part("minute"));
  return day !== undefined && input.weekdays.includes(day) && minute >= input.startMinute && minute < input.endMinute;
}
