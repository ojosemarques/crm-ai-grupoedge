import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  evaluateWhatsAppOutboundPolicy,
  evaluateWhatsAppServiceWindow,
  isWhatsAppOptOut,
  mapWhatsAppProviderStatus,
  normalizeWhatsAppWebhook,
  verifyWhatsAppChallengeToken,
  verifyWhatsAppSignature,
} from "@/modules/integrations/domain/whatsapp-contracts";

function payload(messages: unknown[] = [], statuses: unknown[] = []) {
  return { object: "whatsapp_business_account", entry: [{ id: "123456789", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "987654321", display_phone_number: "5511999999999" }, messages, statuses } }] }] };
}

describe("CRM-44 contratos WhatsApp Cloud API", () => {
  it("valida assinatura HMAC sobre os bytes brutos e challenge sem expor o segredo", () => {
    const raw = Buffer.from('{"object":"whatsapp_business_account"}');
    const signature = `sha256=${createHmac("sha256", "fixture-secret").update(raw).digest("hex")}`;
    expect(verifyWhatsAppSignature(raw, signature, "fixture-secret")).toBe(true);
    expect(verifyWhatsAppSignature(Buffer.from(`${raw.toString()} `), signature, "fixture-secret")).toBe(false);
    expect(verifyWhatsAppSignature(raw, "sha256=bad", "fixture-secret")).toBe(false);
    expect(verifyWhatsAppChallengeToken("fixture-token", "fixture-token")).toBe(true);
    expect(verifyWhatsAppChallengeToken("wrong", "fixture-token")).toBe(false);
  });

  it("normaliza texto, contexto, botão, mídia, localização, contato e desconhecido", () => {
    const timestamp = "2410513200";
    const events = normalizeWhatsAppWebhook(payload([
      { from: "5511999990001", id: "wamid.text.001", timestamp, type: "text", text: { body: "Olá" }, context: { id: "wamid.previous" } },
      { from: "5511999990001", id: "wamid.button.001", timestamp, type: "interactive", interactive: { type: "button_reply", button_reply: { id: "yes", title: "Sim" } } },
      { from: "5511999990001", id: "wamid.media.001", timestamp, type: "document", document: { id: "media.001", mime_type: "application/pdf", sha256: "abc", filename: "arquivo.pdf" } },
      { from: "5511999990001", id: "wamid.location.001", timestamp, type: "location", location: { latitude: -23.5, longitude: -46.6, name: "Local" } },
      { from: "5511999990001", id: "wamid.contact.001", timestamp, type: "contacts", contacts: [{ name: { formatted_name: "Contato" } }] },
      { from: "5511999990001", id: "wamid.unknown.001", timestamp, type: "future_type" },
    ]));
    expect(events).toHaveLength(6);
    expect(events[0]).toMatchObject({ kind: "MESSAGE", body: "Olá", replyToExternalMessageId: "wamid.previous", messageType: "TEXT" });
    expect(events[1]).toMatchObject({ body: "Sim" });
    expect(events[2]).toMatchObject({ messageType: "MEDIA_REFERENCE", media: { providerMediaId: "media.001", providerMimeType: "application/pdf", fileName: "arquivo.pdf" } });
    expect(events[3]).toMatchObject({ body: "Local" });
    expect(events[4]).toMatchObject({ body: "1 contato(s) compartilhado(s)" });
    expect(events[5]).toMatchObject({ reviewReason: "MESSAGE_TYPE_UNKNOWN:future_type" });
  });

  it("mantém janela exata de 24 horas e não confunde template local com aprovado", () => {
    const inbound = new Date("2046-04-20T12:00:00.000Z");
    expect(evaluateWhatsAppServiceWindow(inbound, new Date("2046-04-21T11:59:59.000Z"))).toMatchObject({ open: true, remainingSeconds: 1 });
    expect(evaluateWhatsAppServiceWindow(inbound, new Date("2046-04-21T12:00:00.000Z"))).toMatchObject({ open: true, remainingSeconds: 0 });
    expect(evaluateWhatsAppServiceWindow(inbound, new Date("2046-04-21T12:00:00.001Z"))).toMatchObject({ open: false, remainingSeconds: 0 });
    expect(evaluateWhatsAppOutboundPolicy({ lastCustomerInboundAt: inbound, now: new Date("2046-04-21T11:00:00Z"), hasTemplate: false, providerTemplateStatus: null, optOut: false }).code).toBe("FREE_FORM_WINDOW_OPEN");
    expect(evaluateWhatsAppOutboundPolicy({ lastCustomerInboundAt: inbound, now: new Date("2046-04-22T12:00:00Z"), hasTemplate: false, providerTemplateStatus: null, optOut: false }).code).toBe("WHATSAPP_TEMPLATE_REQUIRED");
    expect(evaluateWhatsAppOutboundPolicy({ lastCustomerInboundAt: null, now: inbound, hasTemplate: true, providerTemplateStatus: "LOCAL_ONLY", optOut: false }).code).toBe("WHATSAPP_TEMPLATE_NOT_PROVIDER_APPROVED");
    expect(evaluateWhatsAppOutboundPolicy({ lastCustomerInboundAt: null, now: inbound, hasTemplate: true, providerTemplateStatus: "APPROVED", optOut: false }).allowed).toBe(true);
    expect(evaluateWhatsAppOutboundPolicy({ lastCustomerInboundAt: inbound, now: inbound, hasTemplate: false, providerTemplateStatus: null, optOut: true }).code).toBe("WHATSAPP_OPT_OUT");
  });

  it("reconhece opt-out explícito e preserva status desconhecido para revisão", () => {
    expect(isWhatsAppOptOut("NÃO ME CONTATE! ")).toBe(true);
    expect(isWhatsAppOptOut("Talvez depois")).toBe(false);
    expect(mapWhatsAppProviderStatus("delivered")).toMatchObject({ status: "DELIVERED", reviewReason: null });
    expect(mapWhatsAppProviderStatus("failed", false)).toMatchObject({ status: "FAILED_TRANSIENT", transient: true });
    expect(mapWhatsAppProviderStatus("future_status")).toMatchObject({ status: null, reviewReason: "STATUS_UNKNOWN:future_status" });
  });
});
