import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createMillionSendWebhookService } from "@/modules/integrations/application/millionsend-webhook-service";

const now = new Date("2026-10-09T14:00:00.000Z");
const timestamp = String(Math.floor(now.getTime() / 1_000));
const webhookKey = Buffer.from("fixture-million-send-webhook-secret").toString("base64");
const environment = {
  APP_CANONICAL_URL: "https://crm.example.test",
  MILLIONSEND_OPEN_DOT_CLIENT_ID: "open-dot-email",
  MILLIONSEND_OPEN_DOT_SECRET: "fixture-open-dot-secret-with-more-than-32-chars",
  MILLIONSEND_WEBHOOK_SECRET: `whsec_${webhookKey}`,
};

function signedInput(rawBody: string, at = timestamp) {
  const id = "webhook-event-001";
  const signature = createHmac("sha256", Buffer.from(webhookKey, "base64")).update(`${id}.${at}.${rawBody}`).digest("base64");
  return { rawBody, id, timestamp: at, signature: `v1,${signature}` };
}

describe("webhook MillionSend", () => {
  it("valida a assinatura e encaminha somente eventos operacionais", async () => {
    const rawBody = JSON.stringify({
      type: "email.delivered",
      created_at: "2026-10-09T13:59:00.000Z",
      data: { email_id: "provider-message-001", to: ["contato@politizai.com"] },
    });
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        externalEventId: "webhook-event-001",
        providerMessageId: "provider-message-001",
        type: "DELIVERED",
        occurredAt: "2026-10-09T13:59:00.000Z",
        automaticReply: false,
        metadata: {},
      });
      return new Response(JSON.stringify({ eventId: "event-001" }), { status: 202 });
    });
    const service = createMillionSendWebhookService({ environment, fetchImpl: fetcher, now: () => now });

    await expect(service.ingest(signedInput(rawBody))).resolves.toEqual({ accepted: true, forwarded: true, type: "DELIVERED" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("recusa assinatura adulterada e timestamp vencido", async () => {
    const rawBody = JSON.stringify({ type: "email.bounced", created_at: now.toISOString(), data: { email_id: "provider-message-001" } });
    const service = createMillionSendWebhookService({ environment, fetchImpl: vi.fn<typeof fetch>(), now: () => now });
    await expect(service.ingest({ ...signedInput(rawBody), signature: "v1,invalid" })).rejects.toThrow(/assinatura/i);
    await expect(service.ingest(signedInput(rawBody, String(Math.floor(now.getTime() / 1_000) - 301)))).rejects.toThrow(/janela temporal/i);
  });
});
