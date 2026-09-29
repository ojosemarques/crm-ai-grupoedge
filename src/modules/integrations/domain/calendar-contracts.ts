import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { calendarOperations, calendarScenarios } from "@/modules/integrations/domain/calendar-shared-contracts";
import { canonicalJson } from "@/modules/integrations/domain/integration-policy";

export { calendarOperations, calendarScenarios } from "@/modules/integrations/domain/calendar-shared-contracts";
export type { CalendarOperation, CalendarScenario } from "@/modules/integrations/domain/calendar-shared-contracts";

export const CALENDAR_CONNECTION_KEY = "calendar-local-sandbox";
export const CALENDAR_PROVIDER_KEY = "CALENDAR_LOCAL_SANDBOX";
export const CALENDAR_ADAPTER_KEY = "calendar-channel-v1";
export const CALENDAR_CONTRACT_VERSION = "calendar-channel/1.0";
export const CALENDAR_SIMULATION_LABEL = "Calendário local simulado; nenhum evento saiu deste ambiente.";
export const CALENDAR_MAX_CALLBACK_BYTES = 64 * 1024;
export const CALENDAR_JOB_MAX_ATTEMPTS = 3;
export const CALENDAR_CALLBACK_TOLERANCE_SECONDS = 300;

const uuid = z.string().uuid();
const opaqueKey = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9:._-]+$/);
const instant = z.coerce.date();

export const calendarSyncMeetingSchema = z.object({
  meetingId: uuid,
  scenario: z.enum(calendarScenarios).default("SUCCESS"),
  idempotencyKey: opaqueKey,
  correlationId: opaqueKey,
}).strict();

export const calendarConfigureSchema = z.object({
  revision: z.number().int().positive().optional(),
  displayName: z.string().trim().min(3).max(120),
  syncPastDays: z.number().int().min(0).max(365),
  syncFutureDays: z.number().int().min(1).max(730),
  maxItemsPerRun: z.number().int().min(1).max(500),
}).strict();

export const calendarCallbackSchema = z.object({
  eventId: opaqueKey,
  nonce: opaqueKey,
  operation: z.enum(calendarOperations),
  externalEventId: opaqueKey,
  externalVersion: z.number().int().nonnegative(),
  externalEtag: z.string().trim().min(1).max(300).nullable().optional(),
  occurredAt: instant,
  meetingId: uuid.nullable().optional(),
  baseMeetingRevision: z.number().int().positive().nullable().optional(),
  leadId: uuid.nullable().optional(),
  closerId: uuid.nullable().optional(),
  title: z.string().trim().min(2).max(200).nullable().optional(),
  startsAt: instant.nullable().optional(),
  endsAt: instant.nullable().optional(),
  timeZone: z.literal("America/Sao_Paulo").default("America/Sao_Paulo"),
  reason: z.string().trim().min(3).max(2_000).nullable().optional(),
  origin: z.literal("LOCAL_SANDBOX").default("LOCAL_SANDBOX"),
  externalEgress: z.literal(false).optional().default(false),
}).strict().superRefine((value, context) => {
  if (value.operation === "CREATE") {
    if (!value.leadId) context.addIssue({ code: "custom", path: ["leadId"], message: "Criação externa exige lead conhecido." });
    if (!value.closerId) context.addIssue({ code: "custom", path: ["closerId"], message: "Criação externa exige closer conhecido." });
    if (!value.title) context.addIssue({ code: "custom", path: ["title"], message: "Criação externa exige título." });
  } else if (!value.meetingId) {
    context.addIssue({ code: "custom", path: ["meetingId"], message: "Alteração externa exige reunião conhecida." });
  }
  if (value.operation === "CREATE" || value.operation === "RESCHEDULE") {
    if (!value.startsAt || !value.endsAt) context.addIssue({ code: "custom", path: ["startsAt"], message: "Criação ou remarcação exige início e fim." });
    else if (value.endsAt <= value.startsAt) context.addIssue({ code: "custom", path: ["endsAt"], message: "O fim precisa ser posterior ao início." });
  }
  if (value.operation === "CANCEL" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Cancelamento exige motivo." });
  }
});

export type CalendarCallback = z.output<typeof calendarCallbackSchema>;

export function sha256Calendar(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function callbackKey(workspaceId: string) {
  return sha256Calendar(`politizai-calendar-local-callback:${workspaceId}:v1`);
}

export function signLocalCalendarCallback(workspaceId: string, timestamp: string, rawBody: Buffer) {
  return createHmac("sha256", callbackKey(workspaceId))
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");
}

export function verifyLocalCalendarCallback(input: Readonly<{
  workspaceId: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: Buffer;
  now: Date;
}>) {
  if (!input.timestamp || !/^\d{10,13}$/.test(input.timestamp)) return { valid: false as const, reason: "TIMESTAMP_INVALID" as const };
  const numeric = Number(input.timestamp);
  const timestampMs = input.timestamp.length === 10 ? numeric * 1_000 : numeric;
  if (!Number.isSafeInteger(timestampMs)) return { valid: false as const, reason: "TIMESTAMP_INVALID" as const };
  if (Math.abs(input.now.getTime() - timestampMs) > CALENDAR_CALLBACK_TOLERANCE_SECONDS * 1_000) {
    return { valid: false as const, reason: "TIMESTAMP_EXPIRED" as const };
  }
  if (!input.signature || !/^[a-f0-9]{64}$/.test(input.signature)) return { valid: false as const, reason: "SIGNATURE_INVALID" as const };
  const expected = Buffer.from(signLocalCalendarCallback(input.workspaceId, input.timestamp, input.rawBody), "hex");
  const supplied = Buffer.from(input.signature, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
    ? { valid: true as const, timestamp: new Date(timestampMs) }
    : { valid: false as const, reason: "SIGNATURE_INVALID" as const };
}

export function calendarPayloadHash(value: unknown) {
  return sha256Calendar(canonicalJson(value));
}

export function calendarDurationMinutes(startsAt: Date, endsAt: Date) {
  const value = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
  if (value !== 30 && value !== 40) return null;
  return value as 30 | 40;
}
