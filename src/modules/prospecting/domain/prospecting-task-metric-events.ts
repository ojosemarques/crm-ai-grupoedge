import type { CommercialMetricEventType } from "@/generated/prisma/client";

export type ProspectingTaskMetricEvent = Readonly<{
  eventType: CommercialMetricEventType;
  eventKeySuffix: string;
  channel: "PHONE" | "WHATSAPP" | "INSTAGRAM";
}>;

export function prospectingTaskMetricEvents(
  kind: string,
  result: string | null,
): readonly ProspectingTaskMetricEvent[] {
  if (kind === "CALL") {
    const attempted = { eventType: "CALL_ATTEMPTED", eventKeySuffix: "call-attempted", channel: "PHONE" } as const;
    if (["CONNECTED", "CALLBACK_REQUESTED", "WHATSAPP_SHARED"].includes(result ?? "")) return [attempted, { eventType: "CALL_CONNECTED", eventKeySuffix: "call-connected", channel: "PHONE" }];
    if (["NO_ANSWER", "BUSY", "VOICEMAIL"].includes(result ?? "")) return [attempted, { eventType: "CALL_UNANSWERED", eventKeySuffix: "call-unanswered", channel: "PHONE" }];
    if (["WRONG_NUMBER", "CHANNEL_UNAVAILABLE"].includes(result ?? "")) return [attempted, { eventType: "CALL_FAILED", eventKeySuffix: "call-failed", channel: "PHONE" }];
    return [attempted];
  }
  if (kind === "WHATSAPP") {
    if (result === "SENT") return [{ eventType: "WHATSAPP_MESSAGE_SENT", eventKeySuffix: "whatsapp-message-sent", channel: "WHATSAPP" }];
    if (result === "NO_WHATSAPP") return [{ eventType: "WHATSAPP_UNAVAILABLE", eventKeySuffix: "whatsapp-unavailable", channel: "WHATSAPP" }];
    if (result === "OTHER") return [{ eventType: "WHATSAPP_OTHER", eventKeySuffix: "whatsapp-other", channel: "WHATSAPP" }];
  }
  if (kind === "INSTAGRAM_MESSAGE" && result === "SENT") {
    return [{ eventType: "INSTAGRAM_MESSAGE_SENT", eventKeySuffix: "instagram-message-sent", channel: "INSTAGRAM" }];
  }
  if (kind === "INSTAGRAM_FOLLOW" && result === "COMPLETED") {
    return [{ eventType: "INSTAGRAM_FOLLOW_COMPLETED", eventKeySuffix: "instagram-follow-completed", channel: "INSTAGRAM" }];
  }
  return [];
}
