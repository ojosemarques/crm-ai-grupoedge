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
      { kind: "CALL", result: "CHANNEL_UNAVAILABLE", count: 2 },
      { kind: "INSTAGRAM_MESSAGE", result: "SENT", count: 6 },
      { kind: "INSTAGRAM_MESSAGE", result: "PROFILE_NOT_FOUND", count: 2 },
      { kind: "INSTAGRAM_MESSAGE", result: "FAILED", count: 1 },
      { kind: "INSTAGRAM_FOLLOW", result: "COMPLETED", count: 3 },
      { kind: "INSTAGRAM_FOLLOW", result: "ALREADY_FOLLOWING", count: 7 },
      { kind: "INSTAGRAM_FOLLOW", result: "PROFILE_NOT_FOUND", count: 2 },
      { kind: "INSTAGRAM_FOLLOW", result: "CHANNEL_UNAVAILABLE", count: 1 },
    ])).toEqual({
      callsCompleted: 17,
      callsConnected: 2,
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
});
