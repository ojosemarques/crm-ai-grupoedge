import type { ActivityDirection, ActivityResult, ActivityType, CommercialMetricEventType } from "@/generated/prisma/client";

export function manualActivityMetricEvents(
  type: ActivityType,
  result: ActivityResult | null,
  direction: ActivityDirection,
  communicationChannel?: string | null,
): readonly Readonly<{ eventType: CommercialMetricEventType; eventKeySuffix: string; channel: string | null; metricResult?: string }>[] {
  if (direction === "INBOUND" && type === "MESSAGE_RECEIVED") return [
    { eventType: "INBOUND_MESSAGE_RECEIVED", eventKeySuffix: "message-received", channel: null },
    { eventType: "HUMAN_RESPONSE_CONFIRMED", eventKeySuffix: "human-response-confirmed", channel: null },
  ];
  if (direction !== "OUTBOUND") return [];
  if (type === "MESSAGE_SENT" && communicationChannel === "INSTAGRAM" && (result === "SENT" || result === null)) return [
    { eventType: "INSTAGRAM_MESSAGE_SENT", eventKeySuffix: "instagram-message-sent", channel: "INSTAGRAM" },
  ];
  if (type === "EMAIL" && (result === "SENT" || result === null)) return [
    { eventType: "EMAIL_SENT", eventKeySuffix: "email-sent", channel: "EMAIL" },
  ];
  const isCall = type === "CALL" || type === "CALL_CONNECTED" || type === "CALL_UNANSWERED";
  const connected = isCall && (result === "CONNECTED" || result === null && type === "CALL_CONNECTED");
  const unanswered = isCall && (result === "NOT_CONNECTED" || result === null && type === "CALL_UNANSWERED");
  if (!connected && !unanswered) return [];
  return [
    { eventType: "CALL_ATTEMPTED", eventKeySuffix: "call-attempted", channel: "PHONE" },
    { eventType: connected ? "CALL_CONNECTED" : "CALL_UNANSWERED", eventKeySuffix: connected ? "call-connected" : "call-unanswered", channel: "PHONE", ...(type === "CALL_UNANSWERED" && unanswered ? { metricResult: "NO_ANSWER" } : {}) },
  ];
}

export function manualActivityMetricCorrection(
  type: ActivityType,
  direction: ActivityDirection,
  previousResult: ActivityResult | null,
  correctedResult: ActivityResult | null,
) {
  if (previousResult === correctedResult) return [];
  return [
    ...manualActivityMetricEvents(type, previousResult, direction).map((event) => ({ event, quantity: -1 as const, action: "reversed" as const, result: event.metricResult ?? previousResult })),
    ...manualActivityMetricEvents(type, correctedResult, direction).map((event) => ({ event, quantity: 1 as const, action: "replacement" as const, result: event.metricResult ?? correctedResult })),
  ];
}
