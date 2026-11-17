import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createMillionSendWebhookService, resolveMillionSendEventWorkspace } from "@/modules/integrations/application/millionsend-webhook-service";

const now = new Date("2026-10-09T14:00:00.000Z");
const timestamp = String(Math.floor(now.getTime() / 1_000));
const webhookKey = Buffer.from("fixture-million-send-webhook-secret").toString("base64");
const environment = {
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
    const recordEvent = vi.fn(async (input: Record<string, unknown>) => {
      expect(input).toEqual({
        externalEventId: "webhook-event-001",
        providerMessageId: "provider-message-001",
        type: "DELIVERED",
        occurredAt: "2026-10-09T13:59:00.000Z",
        automaticReply: false,
        metadata: {},
      });
      return { eventId: "event-001", matched: true };
    });
    const service = createMillionSendWebhookService({ environment, recordEvent, now: () => now });

    await expect(service.ingest(signedInput(rawBody))).resolves.toEqual({ accepted: true, forwarded: true, type: "DELIVERED" });
    expect(recordEvent).toHaveBeenCalledOnce();
  });

  it("recusa assinatura adulterada e timestamp vencido", async () => {
    const rawBody = JSON.stringify({ type: "email.bounced", created_at: now.toISOString(), data: { email_id: "provider-message-001" } });
    const service = createMillionSendWebhookService({ environment, recordEvent: vi.fn(), now: () => now });
    await expect(service.ingest({ ...signedInput(rawBody), signature: "v1,invalid" })).rejects.toThrow(/assinatura/i);
    await expect(service.ingest(signedInput(rawBody, String(Math.floor(now.getTime() / 1_000) - 301)))).rejects.toThrow(/janela temporal/i);
  });

  it("resolve um único workspace e recusa colisão entre tenants", () => {
    expect(resolveMillionSendEventWorkspace([])).toBeNull();
    expect(resolveMillionSendEventWorkspace([{ workspaceId: "workspace-a" }])).toBe("workspace-a");
    expect(() => resolveMillionSendEventWorkspace([{ workspaceId: "workspace-a" }, { workspaceId: "workspace-b" }])).toThrow(/mais de um workspace/i);
  });
});
