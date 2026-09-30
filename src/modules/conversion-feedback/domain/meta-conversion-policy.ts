import { createHash } from "node:crypto";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function metaConversionDeduplicationKey(input: Readonly<{ workspaceId: string; conversionId: string; eventName: string }>) {
  return `meta-capi:${input.workspaceId}:${input.conversionId}:${input.eventName}`;
}

export function buildMinimizedMetaConversion(input: Readonly<{
  workspaceId: string; conversionId: string; contactId: string;
  eventName: "Lead" | "CompleteRegistration" | "Schedule" | "Purchase";
  occurredAt: Date; valueCents: bigint | null; emails: readonly string[]; phones: readonly string[];
  purposeVersionId: string; consentState: "GRANTED"; evaluatedAt: Date;
}>) {
  const emailHashes = input.emails.slice(0, 2).map((value) => hash(value.trim().toLowerCase()));
  const phoneHashes = input.phones.slice(0, 2).map((value) => hash(value.replace(/\D/g, "")));
  return Object.freeze({
    provider: "META" as const, contractVersion: "1.0" as const,
    eventId: hash(metaConversionDeduplicationKey(input)),
    eventName: input.eventName, eventTime: Math.floor(input.occurredAt.getTime() / 1_000), actionSource: "system_generated" as const,
    userData: { em: emailHashes, ph: phoneHashes, external_id: [hash(input.contactId)] },
    customData: { currency: "BRL" as const, ...(input.valueCents === null ? {} : { valueMinor: input.valueCents.toString() }) },
    privacy: { purposeVersionId: input.purposeVersionId, consentState: input.consentState, evaluatedAt: input.evaluatedAt.toISOString() },
  });
}
