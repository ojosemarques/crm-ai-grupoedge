import { describe, expect, it, vi } from "vitest";

import { LocalWhatsAppTransport, WhatsAppCloudApiTransport, WhatsAppExternalDisabledError } from "@/modules/integrations/application/whatsapp-cloud-api-transport";

const command = { graphApiVersion: "v26.0" as const, phoneNumberId: "123456789", recipient: "5511999990001", body: "Olá", idempotencyKey: "fixture-idempotency-001" };

describe("CRM-44 transporte WhatsApp", () => {
  it("recusa egress por padrão sem chamar fetch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const transport = new WhatsAppCloudApiTransport({ fetchImpl: fetcher });
    await expect(transport.sendText(command, "fixture-token")).rejects.toBeInstanceOf(WhatsAppExternalDisabledError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("mantém simulador determinístico e explicitamente local", async () => {
    const transport = new LocalWhatsAppTransport();
    const first = await transport.sendText(command);
    const second = await transport.sendText(command);
    expect(first).toEqual(second);
    expect(first.externalMessageId).toContain("wamid.local");
    expect(transport.externalEgress).toBe(false);
  });

  it("usa somente origem e versão allowlisted quando explicitamente injetado", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.fixture.001" }] }), { status: 200, headers: { "x-fb-trace-id": "trace-fixture" } }));
    const transport = new WhatsAppCloudApiTransport({ externalEgress: true, fetchImpl: fetcher });
    await expect(transport.sendText(command, "fixture-token")).resolves.toEqual({ externalMessageId: "wamid.fixture.001", requestId: "trace-fixture" });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://graph.facebook.com/v26.0/123456789/messages");
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
  });
});
