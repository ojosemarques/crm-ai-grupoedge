export type ActiveProspectingStageOutcome =
  | "OUTREACH_ATTEMPTED"
  | "CONTACT_CONNECTED"
  | "MEETING_SCHEDULED"
  | "CLOSED_NO_RESPONSE"
  | "DISCARDED";

const connectedCallResults = new Set([
  "CONNECTED",
  "CALLBACK_REQUESTED",
  "WHATSAPP_SHARED",
]);

const attemptedCallResults = new Set([
  "NO_ANSWER",
  "BUSY",
  "VOICEMAIL",
  "WRONG_NUMBER",
  "CHANNEL_UNAVAILABLE",
]);

export function prospectingTaskStageOutcome(
  kind: string,
  result: string,
): ActiveProspectingStageOutcome | null {
  const normalized = result.trim().toUpperCase().replaceAll(" ", "_");
  if (kind === "CALL") {
    if (normalized === "MEETING_SCHEDULED") return "MEETING_SCHEDULED";
    if (connectedCallResults.has(normalized)) return "CONTACT_CONNECTED";
    if (attemptedCallResults.has(normalized)) return "OUTREACH_ATTEMPTED";
    return null;
  }
  if (kind === "WHATSAPP" && ["SENT", "NO_WHATSAPP", "OTHER"].includes(normalized)) {
    return "OUTREACH_ATTEMPTED";
  }
  if (kind === "INSTAGRAM_MESSAGE" && ["SENT", "FAILED", "PROFILE_NOT_FOUND", "CHANNEL_UNAVAILABLE"].includes(normalized)) {
    return "OUTREACH_ATTEMPTED";
  }
  if (kind === "INSTAGRAM_FOLLOW" && ["COMPLETED", "ALREADY_FOLLOWING", "FAILED", "PROFILE_NOT_FOUND", "CHANNEL_UNAVAILABLE"].includes(normalized)) {
    return "OUTREACH_ATTEMPTED";
  }
  return null;
}

export function manualActivityStageOutcome(input: Readonly<{
  type: string;
  result: string | null;
  direction: string;
}>): ActiveProspectingStageOutcome | null {
  if (input.type === "CALL_CONNECTED" || (input.type === "CALL" && input.result === "CONNECTED") || input.type === "MESSAGE_RECEIVED") {
    return "CONTACT_CONNECTED";
  }
  if (input.type === "CALL_UNANSWERED" || (input.type === "CALL" && input.result === "NOT_CONNECTED")) {
    return "OUTREACH_ATTEMPTED";
  }
  if (input.direction === "OUTBOUND" && (input.type === "MESSAGE_SENT" || input.type === "EMAIL") && input.result === "SENT") {
    return "OUTREACH_ATTEMPTED";
  }
  if (input.type === "MEETING" && input.result === "SCHEDULED") {
    return "MEETING_SCHEDULED";
  }
  return null;
}
