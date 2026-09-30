import { describe, expect, it } from "vitest";
import { buildMinimizedMetaConversion, metaConversionDeduplicationKey } from "@/modules/conversion-feedback/domain/meta-conversion-policy";
import { googleConversionCommandSchema, metaConversionCommandSchema } from "@/modules/conversion-feedback/domain/conversion-feedback-contracts";

describe("política de feedback de conversão", () => {
  it("normaliza, hasheia, limita identidades e gera deduplicação determinística", () => {
    const input = { workspaceId: "w", conversionId: "c", contactId: "contact", eventName: "Purchase" as const, occurredAt: new Date("2046-04-20T15:00:00Z"), valueCents: 1299n, emails: [" Lead@Example.COM ", "second@example.com", "ignored@example.com"], phones: ["+55 (11) 99999-0000"], purposeVersionId: "purpose-v1", consentState: "GRANTED" as const, evaluatedAt: new Date("2046-04-20T15:01:00Z") };
    const first = buildMinimizedMetaConversion(input);
    expect(first.eventId).toBe(buildMinimizedMetaConversion(input).eventId);
    expect(metaConversionDeduplicationKey(input)).toBe("meta-capi:w:c:Purchase");
    expect(first.userData.em).toHaveLength(2);
    expect(first.userData.em[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(first.userData.ph[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(first.customData).toEqual({ currency: "BRL", valueMinor: "1299" });
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("Lead@Example.COM");
    expect(serialized).not.toContain("99999-0000");
    expect(serialized).not.toContain("contact\"");
  });

  it("restringe comandos Meta e mantém Google só em validação", () => {
    expect(metaConversionCommandSchema.parse({ action: "QUEUE", conversionId: "00000000-0000-4000-8000-000000000001", eventName: "Lead", idempotencyKey: "meta-conversion-fixture-001" }).action).toBe("QUEUE");
    expect(() => metaConversionCommandSchema.parse({ action: "PROCESS_NEXT", workerId: "manual-public" })).toThrow();
    expect(() => metaConversionCommandSchema.parse({ action: "QUEUE", conversionId: "x", eventName: "Custom", idempotencyKey: "unsafe" })).toThrow();
    expect(googleConversionCommandSchema.parse({ action: "VALIDATE_WRITE_CAPABILITY" })).toEqual({ action: "VALIDATE_WRITE_CAPABILITY" });
  });
});
