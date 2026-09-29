import { describe, expect, it } from "vitest";

import {
  assessTelephonyEvent,
  isWithinTelephonyContactWindow,
  normalizeTelephonyAddress,
  sanitizeTelephonyMetadata,
  signLocalTelephonyCallback,
  telephonyDispositionSchema,
  verifyLocalTelephonyCallback,
} from "@/modules/integrations/domain/telephony-contracts";

describe("contratos de telefonia local", () => {
  it("normaliza somente E.164 com DDI confiável e mascara a apresentação", () => {
    expect(normalizeTelephonyAddress("(11) 98765-4321")).toMatchObject({ success: true, e164: "+5511987654321", countryCode: "55", masked: "+55 ••••••4321" });
    expect(normalizeTelephonyAddress("+99912345678")).toMatchObject({ success: false, reasonCode: "PHONE_COUNTRY_CODE_UNVERIFIED" });
    expect(normalizeTelephonyAddress("9876-5432")).toMatchObject({ success: false, reasonCode: "PHONE_AMBIGUOUS" });
  });

  it("assina callbacks locais e rejeita adulteração", () => {
    const body = Buffer.from('{"eventId":"local:event-1"}');
    const signature = signLocalTelephonyCallback("11111111-1111-4111-8111-111111111111", body);
    expect(verifyLocalTelephonyCallback("11111111-1111-4111-8111-111111111111", body, signature)).toBe(true);
    expect(verifyLocalTelephonyCallback("11111111-1111-4111-8111-111111111111", Buffer.from("changed"), signature)).toBe(false);
  });

  it("separa eventos projetáveis de duplicados, atrasados e regressivos", () => {
    const current = new Date("2046-06-03T12:00:00Z");
    expect(assessTelephonyEvent({ currentStatus: "RINGING", currentSequence: 3, incomingStatus: "ANSWERED", incomingSequence: 4, latestOccurredAt: current, occurredAt: new Date("2046-06-03T12:00:01Z") }).project).toBe(true);
    expect(assessTelephonyEvent({ currentStatus: "RINGING", currentSequence: 3, incomingStatus: "RINGING", incomingSequence: 3, latestOccurredAt: current, occurredAt: current })).toMatchObject({ project: false, reasonCode: "DUPLICATE_OR_OUT_OF_ORDER_SEQUENCE" });
    expect(assessTelephonyEvent({ currentStatus: "ANSWERED", currentSequence: 4, incomingStatus: "RINGING", incomingSequence: 5, latestOccurredAt: current, occurredAt: new Date("2046-06-03T12:00:01Z") })).toMatchObject({ project: false, reasonCode: "STATUS_REGRESSION" });
  });

  it("calcula a janela em America/Sao_Paulo", () => {
    expect(isWithinTelephonyContactWindow({ now: new Date("2046-06-04T15:30:00Z"), timeZone: "America/Sao_Paulo", startMinute: 9 * 60, endMinute: 18 * 60, weekdays: [1, 2, 3, 4, 5] })).toBe(true);
    expect(isWithinTelephonyContactWindow({ now: new Date("2046-06-09T15:30:00Z"), timeZone: "America/Sao_Paulo", startMinute: 9 * 60, endMinute: 18 * 60, weekdays: [1, 2, 3, 4, 5] })).toBe(false);
  });

  it("exige nota em Outro e próxima ação no retorno solicitado", () => {
    const base = { callId: "11111111-1111-4111-8111-111111111111", expectedRevision: 1 };
    expect(telephonyDispositionSchema.safeParse({ ...base, disposition: "OTHER" }).success).toBe(false);
    expect(telephonyDispositionSchema.safeParse({ ...base, disposition: "CALLBACK_REQUESTED" }).success).toBe(false);
  });

  it("mantém apenas metadados explicitamente permitidos", () => {
    expect(sanitizeTelephonyMetadata({ scenario: "BUSY", attempt: 1, token: "secret", phone: "+5511" })).toEqual({ scenario: "BUSY", attempt: 1 });
  });
});
