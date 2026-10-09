import { describe, expect, it } from "vitest";
import { manualActivityMetricCorrection, manualActivityMetricEvents } from "./manual-activity-metric-events";

describe("métricas de atividades registradas manualmente", () => {
  it.each([
    ["CALL_CONNECTED", "CONNECTED", "OUTBOUND", ["CALL_ATTEMPTED", "CALL_CONNECTED"]],
    ["CALL_UNANSWERED", "NOT_CONNECTED", "OUTBOUND", ["CALL_ATTEMPTED", "CALL_UNANSWERED"]],
    ["CALL", "CONNECTED", "OUTBOUND", ["CALL_ATTEMPTED", "CALL_CONNECTED"]],
    ["CALL", "NOT_CONNECTED", "OUTBOUND", ["CALL_ATTEMPTED", "CALL_UNANSWERED"]],
    ["CALL_CONNECTED", "CONNECTED", "INBOUND", []],
    ["MESSAGE_RECEIVED", "RECEIVED", "INBOUND", ["INBOUND_MESSAGE_RECEIVED", "HUMAN_RESPONSE_CONFIRMED"]],
    ["EMAIL", "SENT", "OUTBOUND", ["EMAIL_SENT"]],
    ["EMAIL", null, "OUTBOUND", ["EMAIL_SENT"]],
    ["EMAIL", "SENT", "INBOUND", []],
    ["MESSAGE_SENT", "SENT", "OUTBOUND", []],
  ] as const)("mapeia %s / %s / %s", (type, result, direction, expected) => {
    expect(manualActivityMetricEvents(type, result, direction).map((event) => event.eventType)).toEqual(expected);
  });

  it("conta mensagem manual de Instagram somente quando o canal foi informado", () => {
    expect(manualActivityMetricEvents("MESSAGE_SENT", "SENT", "OUTBOUND", "INSTAGRAM")
      .map((event) => event.eventType)).toEqual(["INSTAGRAM_MESSAGE_SENT"]);
    expect(manualActivityMetricEvents("MESSAGE_SENT", "SENT", "OUTBOUND", "WHATSAPP")).toEqual([]);
  });

  it("classifica a ligação manual não atendida sem inferir um motivo para a ligação genérica", () => {
    expect(manualActivityMetricEvents("CALL_UNANSWERED", "NOT_CONNECTED", "OUTBOUND")[1]?.metricResult).toBe("NO_ANSWER");
    expect(manualActivityMetricEvents("CALL", "NOT_CONNECTED", "OUTBOUND")[1]?.metricResult).toBeUndefined();
  });

  it("estorna e substitui o desfecho de uma ligação corrigida sem alterar o total de tentativas", () => {
    const corrections = manualActivityMetricCorrection("CALL", "OUTBOUND", "NOT_CONNECTED", "CONNECTED");
    expect(corrections.map(({ event, quantity, result }) => [event.eventType, quantity, result])).toEqual([
      ["CALL_ATTEMPTED", -1, "NOT_CONNECTED"],
      ["CALL_UNANSWERED", -1, "NOT_CONNECTED"],
      ["CALL_ATTEMPTED", 1, "CONNECTED"],
      ["CALL_CONNECTED", 1, "CONNECTED"],
    ]);
    expect(manualActivityMetricCorrection("CALL", "OUTBOUND", "CONNECTED", "CONNECTED")).toEqual([]);
    expect(manualActivityMetricCorrection("CALL_UNANSWERED", "OUTBOUND", "NOT_CONNECTED", "CONNECTED")
      .map(({ event, quantity, result }) => [event.eventType, quantity, result])).toEqual([
        ["CALL_ATTEMPTED", -1, "NOT_CONNECTED"],
        ["CALL_UNANSWERED", -1, "NO_ANSWER"],
        ["CALL_ATTEMPTED", 1, "CONNECTED"],
        ["CALL_CONNECTED", 1, "CONNECTED"],
      ]);
  });
});
