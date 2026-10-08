import { describe, expect, it } from "vitest";

import {
  getOperationalRank,
  getSdrQueueRecommendation,
  getSlaBand,
} from "@/modules/leads/domain/sdr-queue-contracts";
import { STALE_CONTACT_HOURS, staleContactCutoff } from "@/modules/leads/domain/lead-operational-policy";

const now = new Date("2033-05-10T15:00:00.000Z");

function recommendationInput(
  overrides: Partial<Parameters<typeof getSdrQueueRecommendation>[0]> = {},
) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    awaitingHumanResponse: false,
    stagePosition: 1,
    priorityCode: "P2" as const,
    firstHumanAttemptAt: "2033-05-10T14:00:00.000Z",
    nextActionAt: "2033-05-10T16:00:00.000Z",
    nextActionKind: "FOLLOW_UP",
    meetingTodayId: null,
    ...overrides,
  };
}

describe("fila determinística do SDR", () => {
  it("considera sem contato recente após 72 horas completas", () => {
    expect(STALE_CONTACT_HOURS).toBe(72);
    expect(staleContactCutoff(now).toISOString()).toBe("2033-05-07T15:00:00.000Z");
  });

  it("mantém os limites persistidos de SLA em 60 e 180 segundos", () => {
    expect(getSlaBand(60, 60, 180)).toBe("HEALTHY");
    expect(getSlaBand(61, 60, 180)).toBe("ATTENTION");
    expect(getSlaBand(180, 60, 180)).toBe("ATTENTION");
    expect(getSlaBand(181, 60, 180)).toBe("CRITICAL");
  });

  it("prioriza ligações antes de follows e mensagens da cadência", () => {
    expect(getOperationalRank({ awaitingHumanResponse: false, nextActionSourceKey: "active-prospecting:cadence:call-1", nextActionKind: "CALL", stagePosition: 1, priorityCode: "P2", nextActionAt: "2033-05-10T14:00:00.000Z" }, now)).toBe(0);
    expect(getOperationalRank({ awaitingHumanResponse: false, nextActionSourceKey: "active-prospecting:cadence:instagram-follow", nextActionKind: "INSTAGRAM_FOLLOW", stagePosition: 1, priorityCode: "P2", nextActionAt: "2033-05-10T14:00:00.000Z" }, now)).toBe(1);
    expect(getOperationalRank({ awaitingHumanResponse: false, nextActionSourceKey: "active-prospecting:cadence:instagram-message-1", nextActionKind: "INSTAGRAM_MESSAGE", stagePosition: 1, priorityCode: "P2", nextActionAt: "2033-05-10T14:00:00.000Z" }, now)).toBe(2);
    expect(getOperationalRank({ awaitingHumanResponse: false, nextActionSourceKey: "active-prospecting:cadence:call-2", nextActionKind: "CALL", stagePosition: 1, priorityCode: "P2", nextActionAt: "2033-05-10T14:00:00.000Z" }, now)).toBe(0);
    expect(getOperationalRank({ awaitingHumanResponse: false, nextActionSourceKey: "active-prospecting:cadence:instagram-message-2", nextActionKind: "INSTAGRAM_MESSAGE", stagePosition: 1, priorityCode: "P2", nextActionAt: "2033-05-10T14:00:00.000Z" }, now)).toBe(2);
    expect(getOperationalRank({ awaitingHumanResponse: true, stagePosition: 2, priorityCode: "P3", nextActionAt: null }, now)).toBe(4);
    expect(getOperationalRank({ awaitingHumanResponse: false, meetingTodayId: "meeting", stagePosition: 2, priorityCode: "P3", nextActionAt: null }, now)).toBe(4);
    expect(getOperationalRank({ awaitingHumanResponse: false, stagePosition: 1, priorityCode: "P1", nextActionAt: "2033-05-10T14:59:59.000Z" }, now)).toBe(5);
    expect(getOperationalRank({ awaitingHumanResponse: false, stagePosition: 0, priorityCode: "P1", nextActionAt: null }, now)).toBe(6);
    expect(getOperationalRank({ awaitingHumanResponse: false, stagePosition: 0, priorityCode: "P2", nextActionAt: null }, now)).toBe(7);
    expect(getOperationalRank({ awaitingHumanResponse: false, stagePosition: 0, priorityCode: "P3", nextActionAt: null }, now)).toBe(8);
    expect(getOperationalRank({ awaitingHumanResponse: false, stagePosition: 1, priorityCode: "P1", nextActionAt: "2033-05-10T16:00:00.000Z" }, now)).toBe(9);
  });

  it("explica resposta, lead novo e retorno vencido", () => {
    expect(getSdrQueueRecommendation(recommendationInput({ awaitingHumanResponse: true }), now)).toMatchObject({
      code: "RESPOND_NOW",
      label: "Responder agora",
    });
    expect(getSdrQueueRecommendation(recommendationInput({ stagePosition: 0, firstHumanAttemptAt: null }), now)).toMatchObject({
      code: "CALL_NOW",
      label: "Ligar agora",
    });
    expect(getSdrQueueRecommendation(recommendationInput({ nextActionAt: "2033-05-10T14:00:00.000Z" }), now)).toMatchObject({
      code: "EXECUTE_RETURN",
      label: "Executar retorno",
    });
  });

  it("trata ausência de próxima ação como erro operacional", () => {
    expect(getSdrQueueRecommendation(recommendationInput({ nextActionAt: null }), now)).toMatchObject({
      code: "CREATE_NEXT_ACTION",
      label: "Criar próxima ação",
      reason: expect.stringContaining("erro operacional"),
    });
  });
});
