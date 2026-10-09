import { describe, expect, it } from "vitest";

import {
  buildProspectingDailyActionPlan,
  summarizeProspectingTaskResults,
} from "@/modules/prospecting/domain/prospecting-daily-metrics";

describe("métricas diárias da prospecção", () => {
  it("separa conclusão, atendimento e cada desfecho sem perder tentativas", () => {
    expect(summarizeProspectingTaskResults([
      { kind: "CALL", result: "CONNECTED", count: 2 },
      { kind: "CALL", result: "CALLBACK_REQUESTED", count: 2 },
      { kind: "CALL", result: "WHATSAPP_SHARED", count: 1 },
      { kind: "CALL", result: "NO_ANSWER", count: 3 },
      { kind: "CALL", result: "BUSY", count: 4 },
      { kind: "CALL", result: "VOICEMAIL", count: 5 },
      { kind: "CALL", result: "WRONG_NUMBER", count: 1 },
      { kind: "CALL", result: "CHANNEL_UNAVAILABLE", count: 2 },
      { kind: "INSTAGRAM_MESSAGE", result: "SENT", count: 6 },
      { kind: "INSTAGRAM_MESSAGE", result: "PROFILE_NOT_FOUND", count: 2 },
      { kind: "INSTAGRAM_MESSAGE", result: "FAILED", count: 1 },
      { kind: "INSTAGRAM_FOLLOW", result: "COMPLETED", count: 3 },
      { kind: "INSTAGRAM_FOLLOW", result: "ALREADY_FOLLOWING", count: 7 },
      { kind: "INSTAGRAM_FOLLOW", result: "PROFILE_NOT_FOUND", count: 2 },
      { kind: "INSTAGRAM_FOLLOW", result: "CHANNEL_UNAVAILABLE", count: 1 },
    ])).toEqual({
      callsCompleted: 20,
      callsConnected: 5,
      callsCallbackRequested: 2,
      callsWhatsappShared: 1,
      callsNoAnswer: 3,
      callsBusy: 4,
      callsVoicemail: 5,
      callsWrongNumber: 1,
      callsChannelUnavailable: 2,
      callsFailed: 3,
      instagramMessagesCompleted: 9,
      instagramMessagesSent: 6,
      instagramMessagesProfileNotFound: 2,
      instagramMessagesFailed: 1,
      instagramFollowsAttempted: 13,
      instagramFollowsCompleted: 3,
      instagramFollowsAlreadyFollowing: 7,
      instagramFollowsProfileNotFound: 2,
      instagramFollowsFailed: 1,
    });
  });

  it("monta a carga diária por etapa da cadência e prioriza retornos", () => {
    expect(buildProspectingDailyActionPlan([
      { stepKey: "instagram-message-2", action: "INSTAGRAM_MESSAGE", completed: 4, pending: 21 },
      { stepKey: "call-1", action: "CALL", completed: 18, pending: 32 },
      { stepKey: "follow-up", action: "FOLLOW_UP", completed: 2, pending: 3 },
      { stepKey: "instagram-follow", action: "INSTAGRAM_FOLLOW", completed: 0, pending: 50 },
      { stepKey: "email-1", action: "EMAIL", completed: 10, pending: 0 },
      { stepKey: "call-2", action: "CALL", completed: 0, pending: 0 },
    ])).toEqual([
      { key: "follow-up", label: "Retornos", kind: "FOLLOW_UP", dayNumber: null, planned: 5, completed: 2, pending: 3 },
      { key: "call-1", label: "Ligação 1", kind: "CALL", dayNumber: 1, planned: 50, completed: 18, pending: 32 },
      { key: "instagram-follow", label: "Seguir no Instagram", kind: "INSTAGRAM_FOLLOW", dayNumber: 1, planned: 50, completed: 0, pending: 50 },
      { key: "instagram-message-2", label: "Mensagem no Instagram 2", kind: "INSTAGRAM_MESSAGE", dayNumber: 8, planned: 25, completed: 4, pending: 21 },
    ]);
  });
});
