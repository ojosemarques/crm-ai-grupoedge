type ContactActivity = Readonly<{
  id: string;
  type: string;
  direction: string;
  result: string | null;
  occurredAt: Date;
  createdAt: Date;
  correctsActivityId: string | null;
  newValues: unknown;
}>;

const callTypes = new Set(["CALL", "CALL_CONNECTED", "CALL_UNANSWERED"]);

export function summarizeCorrectedContactHistory(activities: readonly ContactActivity[]) {
  const correctedResults = new Map<string, "CONNECTED" | "NOT_CONNECTED">();
  for (const activity of [...activities].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))) {
    if (!activity.correctsActivityId || correctedResults.has(activity.correctsActivityId)) continue;
    const values = activity.newValues;
    const result = values && typeof values === "object" && !Array.isArray(values) && "result" in values ? values.result : null;
    if (result === "CONNECTED" || result === "NOT_CONNECTED") correctedResults.set(activity.correctsActivityId, result);
  }
  const originals = activities.filter((activity) => !activity.correctsActivityId);
  const outboundCalls = originals.filter((activity) => callTypes.has(activity.type) && activity.direction === "OUTBOUND");
  const connectedAt = originals.flatMap((activity) => {
    if (activity.type === "MESSAGE_RECEIVED" && activity.direction === "INBOUND") return [activity.occurredAt];
    if (!callTypes.has(activity.type) || activity.direction !== "OUTBOUND") return [];
    const result = correctedResults.get(activity.id) ?? activity.result ?? (activity.type === "CALL_CONNECTED" ? "CONNECTED" : "NOT_CONNECTED");
    return result === "CONNECTED" ? [activity.occurredAt] : [];
  }).sort((left, right) => left.getTime() - right.getTime());
  return { outboundCalls: outboundCalls.length, connectedCalls: outboundCalls.filter((activity) =>
    (correctedResults.get(activity.id) ?? activity.result ?? (activity.type === "CALL_CONNECTED" ? "CONNECTED" : "NOT_CONNECTED")) === "CONNECTED").length,
  connectedAt };
}
