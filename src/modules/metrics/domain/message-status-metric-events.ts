import type { CommercialMetricEventType } from "@/generated/prisma/client";

const emailStatusMetricEvents: Readonly<Record<string, CommercialMetricEventType>> = Object.freeze({
  QUEUED: "EMAIL_SCHEDULED",
  SENT: "EMAIL_SENT",
  DELIVERED: "EMAIL_DELIVERED",
  REPLIED: "EMAIL_REPLIED",
  BOUNCED: "EMAIL_BOUNCED",
  SOFT_BOUNCE: "EMAIL_BOUNCED",
  HARD_BOUNCE: "EMAIL_BOUNCED",
  COMPLAINT: "EMAIL_COMPLAINT",
  UNSUBSCRIBED: "EMAIL_UNSUBSCRIBED",
  CANCELLED: "EMAIL_CANCELLED",
  FAILED: "EMAIL_FAILED",
  FAILED_PERMANENT: "EMAIL_FAILED",
  FAILED_TRANSIENT: "EMAIL_FAILED",
});

export function messageStatusMetricEventType(status: string, channel: string, direction: string): CommercialMetricEventType | null {
  if (channel === "INSTAGRAM" || channel === "INSTAGRAM_MESSAGING") {
    return direction === "OUTBOUND" && status === "SENT" ? "INSTAGRAM_MESSAGE_SENT" : null;
  }
  return channel === "EMAIL" ? emailStatusMetricEvents[status] ?? null : null;
}
