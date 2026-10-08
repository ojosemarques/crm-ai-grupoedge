import { describe, expect, it } from "vitest";

import { summarizeProspectingTaskResults } from "@/modules/prospecting/domain/prospecting-daily-metrics";

describe("métricas diárias da prospecção", () => {
  it("separa conclusão, atendimento e cada desfecho sem perder tentativas", () => {
    expect(summarizeProspectingTaskResults([
      { kind: "CALL", result: "CONNECTED", count: 2 },
      { kind: "CALL", result: "NO_ANSWER", count: 3 },
      { kind: "CALL", result: "BUSY", count: 4 },
      { kind: "CALL", result: "VOICEMAIL", count: 5 },
      { kind: "CALL", result: "WRONG_NUMBER", count: 1 },
      { kind: "INSTAGRAM_MESSAGE", result: "SENT", count: 6 },
      { kind: "INSTAGRAM_FOLLOW", result: "ALREADY_FOLLOWING", count: 7 },
    ])).toEqual({
      callsCompleted: 15,
      callsConnected: 2,
      callsNoAnswer: 3,
      callsBusy: 4,
      callsVoicemail: 5,
      callsFailed: 1,
      instagramMessagesSent: 6,
      instagramFollowsCompleted: 7,
    });
  });
});
