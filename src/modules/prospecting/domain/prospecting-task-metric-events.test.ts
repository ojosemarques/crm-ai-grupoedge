import { describe, expect, it } from "vitest";

import { prospectingTaskMetricEvents } from "@/modules/prospecting/domain/prospecting-task-metric-events";

describe("eventos analíticos das tarefas da prospecção", () => {
  it.each([
    ["CALL", "CONNECTED", ["CALL_ATTEMPTED", "CALL_CONNECTED"]],
    ["CALL", "NO_ANSWER", ["CALL_ATTEMPTED", "CALL_UNANSWERED"]],
    ["CALL", "BUSY", ["CALL_ATTEMPTED", "CALL_UNANSWERED"]],
    ["CALL", "VOICEMAIL", ["CALL_ATTEMPTED", "CALL_UNANSWERED"]],
    ["CALL", "WRONG_NUMBER", ["CALL_ATTEMPTED", "CALL_FAILED"]],
    ["CALL", "CHANNEL_UNAVAILABLE", ["CALL_ATTEMPTED", "CALL_FAILED"]],
    ["INSTAGRAM_MESSAGE", "SENT", ["INSTAGRAM_MESSAGE_SENT"]],
    ["INSTAGRAM_MESSAGE", "PROFILE_NOT_FOUND", []],
    ["INSTAGRAM_FOLLOW", "COMPLETED", ["INSTAGRAM_FOLLOW_COMPLETED"]],
    ["INSTAGRAM_FOLLOW", "ALREADY_FOLLOWING", []],
  ] as const)("mapeia %s/%s sem inventar sucesso", (kind, result, expected) => {
    expect(prospectingTaskMetricEvents(kind, result).map((event) => event.eventType)).toEqual(expected);
  });
});
