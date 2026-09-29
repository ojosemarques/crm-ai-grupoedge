import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  assertSafeHeader,
  createStableMessageId,
  createUnsubscribeToken,
  emailLocalStatusSchema,
  normalizeEmailAddress,
  parseDeliveryStatusNotification,
  resolveEmailThread,
  sanitizeEmailHtml,
  shouldProjectEmailStatus,
  validateMimeLimits,
  verifyEmailWebhookSignature,
  verifyUnsubscribeToken,
} from "@/modules/integrations/domain/email-contracts";

describe("CRM-45 contratos de e-mail", () => {
  it("normaliza endereço, gera Message-ID estável e rejeita header injection", () => {
    expect(normalizeEmailAddress("  Pessoa@Example.COM ")).toMatchObject({ success: true, normalized: "pessoa@example.com", domain: "example.com" });
    expect(createStableMessageId("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "demo.local")).toBe(createStableMessageId("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "demo.local"));
    expect(() => assertSafeHeader("ok@example.com\r\nBcc: leak@example.com", "to")).toThrow("EMAIL_HEADER_INJECTION");
  });

  it("resolve thread somente por referências, nunca por assunto", () => {
    const candidates = [{ conversationId: "conversation-a", messageIdHeader: "<a@demo.local>" }, { conversationId: "conversation-b", messageIdHeader: "<b@demo.local>" }];
    expect(resolveEmailThread({ inReplyTo: "<a@demo.local>", candidates })).toEqual({ outcome: "MATCHED", conversationId: "conversation-a" });
    expect(resolveEmailThread({ candidates })).toMatchObject({ outcome: "REVIEW_REQUIRED", reason: "THREAD_NOT_FOUND" });
    expect(resolveEmailThread({ references: ["<a@demo.local>", "<b@demo.local>"], candidates })).toMatchObject({ outcome: "REVIEW_REQUIRED", reason: "MULTIPLE_THREAD_MATCHES" });
  });

  it("sanitiza HTML ativo e recursos remotos", () => {
    const result = sanitizeEmailHtml('<p onclick="steal()">Oi</p><script>alert(1)</script><img src="https://tracker.invalid/pixel">');
    expect(result).not.toMatch(/onclick|script|tracker\.invalid/i);
    expect(result).toContain("#blocked-remote-content");
  });

  it("aplica limites MIME e status fora de ordem", () => {
    expect(validateMimeLimits({ bytes: 100, parts: 2, depth: 1 })).toBe(true);
    expect(() => validateMimeLimits({ bytes: 100, parts: 41, depth: 1 })).toThrow("EMAIL_MIME_TOO_MANY_PARTS");
    expect(shouldProjectEmailStatus("DELIVERED", "DEFERRED")).toBe(false);
    expect(shouldProjectEmailStatus("SENT", "DELIVERED")).toBe(true);
    expect(shouldProjectEmailStatus("HARD_BOUNCE", "DELIVERED")).toBe(false);
  });

  it("valida assinatura raw-body e unsubscribe opaco e expirável", () => {
    const raw = Buffer.from('{"fixture":true}');
    const signature = `sha256=${createHmac("sha256", "fixture-secret").update(raw).digest("hex")}`;
    expect(verifyEmailWebhookSignature(raw, signature, "fixture-secret")).toBe(true);
    expect(verifyEmailWebhookSignature(raw, signature, "wrong")).toBe(false);
    const token = createUnsubscribeToken({ workspaceId: "00000000-0000-4000-8000-000000000001", contactPointHash: "a".repeat(64), purposeKey: "marketing", expiresAt: 2_000_000_000 }, "fixture-secret");
    expect(token).not.toContain("@");
    expect(verifyUnsubscribeToken(token, "fixture-secret", new Date("2030-01-01"))).toMatchObject({ purposeKey: "marketing" });
    expect(emailLocalStatusSchema.parse({ messageId: "00000000-0000-4000-8000-000000000001", externalEventId: "unsubscribe-local-001", status: "UNSUBSCRIBED", occurredAt: "2030-01-01T12:00:00.000Z" }).status).toBe("UNSUBSCRIBED");
  });

  it("normaliza DSN sem inferir open ou click", () => {
    expect(parseDeliveryStatusNotification("Final-Recipient: rfc822; lead@example.invalid\nAction: failed\nStatus: 5.1.1\nDiagnostic-Code: smtp; user unknown")).toMatchObject({ finalRecipient: "lead@example.invalid", mappedStatus: "HARD_BOUNCE", statusCode: "5.1.1" });
  });
});
