import { describe, expect, it } from "vitest";

import {
  channelCapabilities,
  conversationSlaState,
  escapeTemplateValue,
  nextConversationStatus,
  normalizeChannelAddress,
  renderMessageTemplate,
  shouldProjectMessageStatus,
} from "@/modules/communications/domain/omnichannel-contracts";

describe("CRM-43/44 contratos omnichannel", () => {
  it("expõe capacidades locais explícitas sem fingir providers externos", () => {
    expect(channelCapabilities.find((item) => item.channel === "INTERNAL_SIMULATOR")?.support).toBe("LOCAL_ONLY");
    expect(channelCapabilities.find((item) => item.channel === "WHATSAPP")?.support).toBe("LOCAL_ONLY");
    expect(channelCapabilities.find((item) => item.channel === "SMS")?.support).toBe("FUTURE");
  });

  it("normaliza endereço exato, mascara a exibição e rejeita inválidos", () => {
    expect(normalizeChannelAddress("INTERNAL_SIMULATOR", "(11) 99999-0001")).toMatchObject({ success: true, normalized: "+5511999990001", masked: "+551••••0001" });
    expect(normalizeChannelAddress("EMAIL", "  Pessoa@Example.Test ")).toMatchObject({ success: true, normalized: "pessoa@example.test" });
    expect(normalizeChannelAddress("EMAIL", "inválido")).toEqual({ success: false, code: "INVALID_ADDRESS" });
  });

  it("não rebaixa projeção por evento atrasado ou após terminal", () => {
    expect(shouldProjectMessageStatus("QUEUED", "DELIVERED")).toBe(true);
    expect(shouldProjectMessageStatus("DELIVERED", "ACCEPTED_INTERNAL")).toBe(false);
    expect(shouldProjectMessageStatus("READ", "FAILED_TRANSIENT")).toBe(false);
    expect(shouldProjectMessageStatus("CANCELLED", "DELIVERED")).toBe(false);
  });

  it("projeta espera operacional e SLA determinístico", () => {
    expect(nextConversationStatus("INBOUND", "OPEN")).toBe("PENDING_INTERNAL");
    expect(nextConversationStatus("OUTBOUND", "PENDING_INTERNAL")).toBe("WAITING_CUSTOMER");
    expect(nextConversationStatus("INBOUND", "ARCHIVED")).toBe("ARCHIVED");
    const now = new Date("2046-01-01T12:03:01.000Z");
    expect(conversationSlaState({ status: "PENDING_INTERNAL", waitingSince: new Date("2046-01-01T12:00:00.000Z"), now })).toEqual({ state: "OVERDUE", elapsedSeconds: 181 });
    expect(conversationSlaState({ status: "WAITING_CUSTOMER", waitingSince: new Date(), now })).toEqual({ state: "NOT_RUNNING", elapsedSeconds: null });
  });

  it("renderiza templates apenas com variáveis permitidas e escape seguro", () => {
    expect(escapeTemplateValue("<script>&\"")).toBe("&lt;script&gt;&amp;&quot;");
    expect(renderMessageTemplate("Olá, {{nome}}", ["nome"], { nome: "<Maria>" })).toBe("Olá, &lt;Maria&gt;");
    expect(() => renderMessageTemplate("Olá, {{nome}}", [], {})).toThrow("TEMPLATE_VARIABLE_MISSING:nome");
  });
});
