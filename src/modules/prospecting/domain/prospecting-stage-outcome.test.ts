import { describe, expect, it } from "vitest";

import {
  manualActivityStageOutcome,
  prospectingTaskStageOutcome,
} from "@/modules/prospecting/domain/prospecting-stage-outcome";

describe("prospectingTaskStageOutcome", () => {
  it.each([
    ["CALL", "NO_ANSWER", "OUTREACH_ATTEMPTED"],
    ["CALL", "BUSY", "OUTREACH_ATTEMPTED"],
    ["CALL", "VOICEMAIL", "OUTREACH_ATTEMPTED"],
    ["CALL", "WRONG_NUMBER", "OUTREACH_ATTEMPTED"],
    ["CALL", "CHANNEL_UNAVAILABLE", "OUTREACH_ATTEMPTED"],
    ["CALL", "CONNECTED", "CONTACT_CONNECTED"],
    ["CALL", "CALLBACK_REQUESTED", "CONTACT_CONNECTED"],
    ["CALL", "WHATSAPP_SHARED", "CONTACT_CONNECTED"],
    ["CALL", "MEETING_SCHEDULED", "MEETING_SCHEDULED"],
    ["WHATSAPP", "SENT", "OUTREACH_ATTEMPTED"],
    ["WHATSAPP", "NO_WHATSAPP", "OUTREACH_ATTEMPTED"],
    ["WHATSAPP", "OTHER", "OUTREACH_ATTEMPTED"],
    ["INSTAGRAM_MESSAGE", "SENT", "OUTREACH_ATTEMPTED"],
    ["INSTAGRAM_MESSAGE", "FAILED", "OUTREACH_ATTEMPTED"],
    ["INSTAGRAM_MESSAGE", "PROFILE_NOT_FOUND", "OUTREACH_ATTEMPTED"],
    ["INSTAGRAM_MESSAGE", "CHANNEL_UNAVAILABLE", "OUTREACH_ATTEMPTED"],
    ["INSTAGRAM_FOLLOW", "COMPLETED", "OUTREACH_ATTEMPTED"],
    ["INSTAGRAM_FOLLOW", "ALREADY_FOLLOWING", "OUTREACH_ATTEMPTED"],
    ["INSTAGRAM_FOLLOW", "FAILED", "OUTREACH_ATTEMPTED"],
    ["INSTAGRAM_FOLLOW", "PROFILE_NOT_FOUND", "OUTREACH_ATTEMPTED"],
    ["INSTAGRAM_FOLLOW", "CHANNEL_UNAVAILABLE", "OUTREACH_ATTEMPTED"],
  ])("mapeia %s/%s para %s", (kind, result, expected) => {
    expect(prospectingTaskStageOutcome(kind, result)).toBe(expected);
  });

  it("não move tarefas genéricas por texto livre", () => {
    expect(prospectingTaskStageOutcome("FOLLOW_UP", "Reunião agendada")).toBeNull();
  });
});

describe("manualActivityStageOutcome", () => {
  it.each([
    ["CALL_UNANSWERED", "NOT_CONNECTED", "OUTBOUND", "OUTREACH_ATTEMPTED"],
    ["CALL_CONNECTED", "CONNECTED", "OUTBOUND", "CONTACT_CONNECTED"],
    ["MESSAGE_SENT", "SENT", "OUTBOUND", "OUTREACH_ATTEMPTED"],
    ["EMAIL", "SENT", "OUTBOUND", "OUTREACH_ATTEMPTED"],
    ["MESSAGE_RECEIVED", "RECEIVED", "INBOUND", "CONTACT_CONNECTED"],
    ["MEETING", "SCHEDULED", "INTERNAL", "MEETING_SCHEDULED"],
  ])("mapeia %s/%s/%s para %s", (type, result, direction, expected) => {
    expect(manualActivityStageOutcome({ type, result, direction })).toBe(expected);
  });
});
