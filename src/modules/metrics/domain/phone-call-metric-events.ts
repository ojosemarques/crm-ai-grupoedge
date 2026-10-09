export type PhoneCallMetricEventType = "CALL_ATTEMPTED" | "CALL_CONNECTED" | "CALL_UNANSWERED" | "CALL_FAILED";

export function phoneCallMetricEventType(status: string): PhoneCallMetricEventType | null {
  if (status === "INITIATED") return "CALL_ATTEMPTED";
  if (status === "ANSWERED") return "CALL_CONNECTED";
  if (["BUSY", "NO_ANSWER", "VOICEMAIL"].includes(status)) return "CALL_UNANSWERED";
  if (["FAILED", "CANCELLED"].includes(status)) return "CALL_FAILED";
  return null;
}

export function missingPhoneCallEvents(call: Readonly<{
  initiatedAt: Date | null;
  answeredAt: Date | null;
  status: string;
  statusEvents: readonly Readonly<{ status: string }>[];
}>): readonly PhoneCallMetricEventType[] {
  const observed = new Set(call.statusEvents.flatMap((event) => {
    const eventType = phoneCallMetricEventType(event.status);
    return eventType ? [eventType] : [];
  }));
  const terminal = call.answeredAt ? "CALL_CONNECTED" : phoneCallMetricEventType(call.status);
  return [
    ...(call.initiatedAt && !observed.has("CALL_ATTEMPTED") ? ["CALL_ATTEMPTED" as const] : []),
    ...(terminal && terminal !== "CALL_ATTEMPTED" && !observed.has(terminal) ? [terminal] : []),
  ];
}
