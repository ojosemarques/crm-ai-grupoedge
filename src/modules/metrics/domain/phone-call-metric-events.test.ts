import { describe, expect, it } from "vitest";

import { missingPhoneCallEvents, phoneCallMetricEventType } from "@/modules/metrics/domain/phone-call-metric-events";

describe("fatos de telefonia", () => {
  it("mapeia somente início e desfechos observáveis", () => {
    expect(["QUEUED", "INITIATED", "ANSWERED", "BUSY", "NO_ANSWER", "VOICEMAIL", "FAILED", "CANCELLED"]
      .map(phoneCallMetricEventType)).toEqual([null, "CALL_ATTEMPTED", "CALL_CONNECTED", "CALL_UNANSWERED", "CALL_UNANSWERED", "CALL_UNANSWERED", "CALL_FAILED", "CALL_FAILED"]);
  });

  it("não infere tentativa de chamada enfileirada nem duplica eventos de status", () => {
    const date = new Date("2026-10-09T12:00:00.000Z");
    expect(missingPhoneCallEvents({ initiatedAt: null, answeredAt: null, status: "QUEUED", statusEvents: [{ status: "QUEUED" }] })).toEqual([]);
    expect(missingPhoneCallEvents({ initiatedAt: date, answeredAt: date, status: "COMPLETED", statusEvents: [{ status: "INITIATED" }, { status: "ANSWERED" }] })).toEqual([]);
    expect(missingPhoneCallEvents({ initiatedAt: date, answeredAt: date, status: "COMPLETED", statusEvents: [{ status: "ANSWERED" }] })).toEqual(["CALL_ATTEMPTED"]);
    expect(missingPhoneCallEvents({ initiatedAt: date, answeredAt: null, status: "NO_ANSWER", statusEvents: [] })).toEqual(["CALL_ATTEMPTED", "CALL_UNANSWERED"]);
  });
});
