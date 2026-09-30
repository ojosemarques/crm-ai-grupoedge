import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pageTrackingBatchSchema, verifyPageTrackingSignature } from "./page-tracking";

const now = new Date("2026-09-30T12:00:00Z");
const batch = { consent: true, sessionPublicId: "5807e645-0ae9-4f91-aa26-4be30bba1300", origin: "https://example.com", events: [{ eventId: "4807e645-0ae9-4f91-aa26-4be30bba1300", kind: "PAGE_VIEW", occurredAt: now.toISOString() }] };
describe("coleta consentida de páginas", () => {
  it("valida assinatura HMAC e rejeita alteração ou expiração", () => {
    const raw = JSON.stringify(batch); const timestamp = now.toISOString();
    const signature = createHmac("sha256", "secret").update(`${timestamp}.${raw}`).digest("hex");
    expect(verifyPageTrackingSignature("secret", raw, timestamp, signature, now)).toBe(true);
    expect(verifyPageTrackingSignature("secret", raw + " ", timestamp, signature, now)).toBe(false);
    expect(verifyPageTrackingSignature("secret", raw, timestamp, signature, new Date(now.getTime() + 300001))).toBe(false);
    expect(verifyPageTrackingSignature("secret", raw, timestamp, "invalid", now)).toBe(false);
  });
  it("exige consentimento e rejeita inputs pessoais ou URL de navegação", () => {
    expect(pageTrackingBatchSchema.safeParse(batch).success).toBe(true);
    expect(pageTrackingBatchSchema.safeParse({ ...batch, consent: false }).success).toBe(false);
    expect(pageTrackingBatchSchema.safeParse({ ...batch, email: "person@example.com" }).success).toBe(false);
    expect(pageTrackingBatchSchema.safeParse({ ...batch, events: [{ ...batch.events[0], url: "https://example.com/?email=person@example.com" }] }).success).toBe(false);
  });
  it("limita eventos, duração e cliques a identificadores explícitos", () => {
    expect(pageTrackingBatchSchema.safeParse({ ...batch, events: Array.from({ length: 51 }, () => batch.events[0]) }).success).toBe(false);
    expect(pageTrackingBatchSchema.safeParse({ ...batch, events: [{ ...batch.events[0], kind: "ENGAGEMENT", durationMs: 300001 }] }).success).toBe(false);
    expect(pageTrackingBatchSchema.safeParse({ ...batch, events: [{ ...batch.events[0], kind: "CLICK", target: "cta-contact" }] }).success).toBe(true);
    expect(pageTrackingBatchSchema.safeParse({ ...batch, events: [{ ...batch.events[0], kind: "CLICK", target: "person@example.com" }] }).success).toBe(false);
  });
});
