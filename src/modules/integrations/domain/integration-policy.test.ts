import { describe, expect, it } from "vitest";

import {
  calculateRetryDelaySeconds,
  redactSensitive,
  signLocalWebhook,
  verifyLocalWebhookSignature,
} from "@/modules/integrations/domain/integration-policy";

describe("política da plataforma de integrações", () => {
  it("redige segredos recursivamente", () => {
    expect(redactSensitive({ token: "real", nested: { apiKey: "real", safe: "ok" } })).toEqual({
      token: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", safe: "ok" },
    });
  });

  it("usa backoff exponencial determinístico e respeita retry-after", () => {
    expect(calculateRetryDelaySeconds(1, 5)).toBe(5);
    expect(calculateRetryDelaySeconds(2, 5)).toBeGreaterThan(5);
    expect(calculateRetryDelaySeconds(3, 5, 42)).toBe(42);
  });

  it("valida HMAC e janela temporal sem expor segredo", () => {
    const rawBody = '{"eventId":"evt-local-1"}';
    const timestamp = "2026-09-12T12:00:00.000Z";
    const signature = signLocalWebhook("ephemeral-secret", timestamp, rawBody);
    expect(
      verifyLocalWebhookSignature({
        secret: "ephemeral-secret",
        timestamp,
        signature,
        rawBody,
        now: new Date(timestamp),
        toleranceSeconds: 300,
      }),
    ).toBe("VERIFIED");
    expect(
      verifyLocalWebhookSignature({
        secret: "wrong",
        timestamp,
        signature,
        rawBody,
        now: new Date(timestamp),
        toleranceSeconds: 300,
      }),
    ).toBe("INVALID");
    expect(
      verifyLocalWebhookSignature({ secret: "ephemeral-secret", timestamp, signature, rawBody, now: new Date("2026-09-12T12:06:00.000Z"), toleranceSeconds: 300 }),
    ).toBe("EXPIRED");
  });
});
