import { describe, expect, it } from "vitest";
import { createEphemeralN8nToken, fingerprintN8nToken, safeN8nPayload, signN8nRequest, verifyN8nRequest } from "@/modules/integrations/domain/n8n-policy";

describe("governança local n8n", () => {
  it("gera credencial efêmera e persiste apenas fingerprint seguro", () => {
    const token = createEphemeralN8nToken();
    expect(token).toMatch(/^n8n_local_/);
    expect(fingerprintN8nToken(token)).toMatch(/^[a-f0-9]{16}$/);
    expect(fingerprintN8nToken(token)).not.toContain(token);
  });
  it("valida assinatura, timestamp e corpo canônico", () => {
    const token = "n8n_local_fixture_ephemeral_only"; const timestamp = "2026-09-13T12:00:00.000Z"; const nonce = "nonce_fixture_123456"; const key = "fixture.command.001"; const rawBody = '{"type":"AUTOMATION_RESULT"}';
    const signature = signN8nRequest(token, timestamp, nonce, key, rawBody);
    expect(verifyN8nRequest({ token, timestamp, nonce, idempotencyKey: key, rawBody, signature, now: new Date(timestamp) })).toBe("VERIFIED");
    expect(verifyN8nRequest({ token, timestamp, nonce, idempotencyKey: key, rawBody: "{}", signature, now: new Date(timestamp) })).toBe("INVALID");
    expect(verifyN8nRequest({ token, timestamp, nonce, idempotencyKey: key, rawBody, signature, now: new Date("2026-09-13T12:06:00Z") })).toBe("EXPIRED");
  });
  it("remove campos e valores sensíveis da fronteira", () => {
    expect(safeN8nPayload({ leadId: "1", email: "a@b.test", nested: { token: "x", state: "ok" }, text: "Bearer abc" })).toEqual({ leadId: "1", nested: { state: "ok" }, text: "[REDACTED]" });
  });
});
