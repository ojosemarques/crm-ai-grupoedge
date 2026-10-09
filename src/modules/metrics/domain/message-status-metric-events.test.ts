import { describe, expect, it } from "vitest";

import { messageStatusMetricEventType } from "@/modules/metrics/domain/message-status-metric-events";

describe("métricas por status de mensagem", () => {
  it("conta o envio do e-mail somente no status SENT", () => {
    expect(messageStatusMetricEventType("PROVIDER_ACCEPTED", "EMAIL", "OUTBOUND")).toBeNull();
    expect(messageStatusMetricEventType("SENT", "EMAIL", "OUTBOUND")).toBe("EMAIL_SENT");
    expect(messageStatusMetricEventType("DELIVERED", "EMAIL", "OUTBOUND")).toBe("EMAIL_DELIVERED");
  });

  it("conta mensagem do Instagram somente após envio outbound", () => {
    expect(messageStatusMetricEventType("SENT", "INSTAGRAM", "OUTBOUND")).toBe("INSTAGRAM_MESSAGE_SENT");
    expect(messageStatusMetricEventType("SENT", "INSTAGRAM", "INBOUND")).toBeNull();
    expect(messageStatusMetricEventType("QUEUED", "INSTAGRAM_MESSAGING", "OUTBOUND")).toBeNull();
  });
});
