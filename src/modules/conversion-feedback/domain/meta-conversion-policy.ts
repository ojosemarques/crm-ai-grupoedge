import type { ConsentStateValue } from "@/generated/prisma/client";
import { createHash } from "node:crypto";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function metaConversionDeduplicationKey(input: Readonly<{ workspaceId: string; conversionId: string; eventName: string }>) {
  return `meta-capi:${input.workspaceId}:${input.conversionId}:${input.eventName}`;
}

export function metaConversionEventId(input: Readonly<{ workspaceId: string; conversionId: string; eventName: string }>) {
  return hash(metaConversionDeduplicationKey(input));
}

export function metaAdvertisingStageEvent(stage: string | null): "Schedule" | "MeetingAttended" | null {
  if (stage === "MEETING_SCHEDULED") return "Schedule";
  if (stage === "MEETING_COMPLETED" || stage === "PROPOSAL") return "MeetingAttended";
  return null;
}

export function metaBrowserMatchKeys(input: { fbc?: unknown; fbp?: unknown; fbclid?: string | undefined; clickedAt?: Date }) {
  const clickId = input.fbclid && /^[A-Za-z0-9_-]{1,500}$/.test(input.fbclid) ? input.fbclid : null;
  const cookieClick = typeof input.fbc === "string" && /^fb\.\d{1,3}\.\d{13}\.[A-Za-z0-9_-]{1,500}$/.test(input.fbc) ? input.fbc : null;
  const fbc = clickId && input.clickedAt && !cookieClick?.endsWith(`.${clickId}`)
    ? `fb.1.${input.clickedAt.getTime()}.${clickId}`
    : cookieClick;
  const fbp = typeof input.fbp === "string" && /^fb\.\d{1,3}\.\d{13}\.\d{1,40}$/.test(input.fbp) ? input.fbp : null;
  return { ...(fbc ? { fbc } : {}), ...(fbp ? { fbp } : {}) };
}

export function buildMinimizedMetaConversion(input: Readonly<{
  workspaceId: string; conversionId: string; contactId: string;
  eventName: "Lead" | "CompleteRegistration" | "Schedule" | "MeetingAttended" | "Purchase";
  occurredAt: Date; valueCents: bigint | null; emails: readonly string[]; phones: readonly string[];
  browserMatchKeys?: ReturnType<typeof metaBrowserMatchKeys>;
  eventId?: string; website?: { url: string; userAgent: string }; expectedDatasetId?: string;
  purposeVersionId: string | null; consentState: ConsentStateValue; evaluatedAt: Date;
}>) {
  const emailHashes = input.emails.slice(0, 2).map((value) => hash(value.trim().toLowerCase()));
  const phoneHashes = input.phones.slice(0, 2).map((value) => hash(value.replace(/\D/g, "")));
  return Object.freeze({
    provider: "META" as const, contractVersion: "1.0" as const,
    eventId: input.eventId ?? metaConversionEventId(input),
    eventName: input.eventName, eventTime: Math.floor(input.occurredAt.getTime() / 1_000), actionSource: input.website ? "website" as const : "system_generated" as const,
    ...(input.website ? { eventSourceUrl: input.website.url } : {}),
    ...(input.expectedDatasetId ? { expectedDatasetId: input.expectedDatasetId } : {}),
    userData: { em: emailHashes, ph: phoneHashes, external_id: [hash(input.contactId)], ...input.browserMatchKeys, ...(input.website ? { client_user_agent: input.website.userAgent } : {}) },
    customData: { currency: "BRL" as const, ...(input.valueCents === null ? {} : { valueMinor: input.valueCents.toString() }) },
    privacy: { purposeVersionId: input.purposeVersionId, consentState: input.consentState, evaluatedAt: input.evaluatedAt.toISOString() },
  });
}
