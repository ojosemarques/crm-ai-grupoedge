import { describe, expect, it, vi } from "vitest";

import { MillionSendExternalDisabledError, MillionSendTransport } from "@/modules/integrations/application/millionsend-transport";

const command = {
  from: "jhoncunha@politizai.com",
  replyTo: "jhoncunha@politizai.com",
  to: ["contato@politizai.com"],
  subject: "Teste controlado",
  text: "Mensagem de teste",
  messageId: "<fixture@politizai.com>",
  idempotencyKey: "million-send-fixture-001",
};

describe("transporte MillionSend", () => {
  it("recusa egress por padrão", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const transport = new MillionSendTransport({ fetchImpl: fetcher });
    await expect(transport.send(command, "ms_fixture_key")).rejects.toBeInstanceOf(MillionSendExternalDisabledError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("envia com idempotência e mantém Reply-To na caixa do vendedor", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: "provider-message-001" }), {
      status: 200,
      headers: { "x-request-id": "request-001" },
    }));
    const transport = new MillionSendTransport({ externalEgress: true, fetchImpl: fetcher });

    await expect(transport.send(command, "ms_fixture_key")).resolves.toMatchObject({
      providerMessageId: "provider-message-001",
      requestId: "request-001",
      simulated: false,
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://api.millionsend.com/emails");
    const request = fetcher.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({
      Authorization: "Bearer ms_fixture_key",
      "Idempotency-Key": command.idempotencyKey,
    });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      from: command.from,
      to: command.to,
      reply_to: command.replyTo,
    });
  });
});
