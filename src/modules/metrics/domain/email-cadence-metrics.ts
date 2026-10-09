import { PROSPECTING_EMAIL_SEQUENCE } from "@/modules/prospecting/domain/prospecting-email-sequence";

export type EmailCadenceMetricFact = Readonly<{
  eventType: string;
  cadenceStepKey: string | null;
  quantity: number;
}>;

export type EmailCadenceMetricsRow = Readonly<{
  stepKey: string;
  stepNumber: number;
  dayOffset: number;
  scheduled: number;
  sent: number;
  delivered: number;
  replied: number;
  bounced: number;
  complaints: number;
  unsubscribed: number;
  failed: number;
  expired: number;
  cancelled: number;
}>;

type MutableEmailCadenceMetricsRow = {
  -readonly [Key in keyof EmailCadenceMetricsRow]: EmailCadenceMetricsRow[Key];
};

export const EMAIL_CADENCE_METRIC_EVENT_TYPES = Object.freeze([
  "EMAIL_SCHEDULED",
  "EMAIL_SENT",
  "EMAIL_DELIVERED",
  "EMAIL_REPLIED",
  "EMAIL_BOUNCED",
  "EMAIL_COMPLAINT",
  "EMAIL_UNSUBSCRIBED",
  "EMAIL_FAILED",
  "EMAIL_EXPIRED",
  "EMAIL_CANCELLED",
] as const);

const metricFieldByEvent = {
  EMAIL_SCHEDULED: "scheduled",
  EMAIL_SENT: "sent",
  EMAIL_DELIVERED: "delivered",
  EMAIL_REPLIED: "replied",
  EMAIL_BOUNCED: "bounced",
  EMAIL_COMPLAINT: "complaints",
  EMAIL_UNSUBSCRIBED: "unsubscribed",
  EMAIL_FAILED: "failed",
  EMAIL_EXPIRED: "expired",
  EMAIL_CANCELLED: "cancelled",
} as const satisfies Readonly<Record<(typeof EMAIL_CADENCE_METRIC_EVENT_TYPES)[number], keyof Omit<EmailCadenceMetricsRow, "stepKey" | "stepNumber" | "dayOffset">>>;

export function summarizeEmailCadenceMetrics(
  facts: readonly EmailCadenceMetricFact[],
): readonly EmailCadenceMetricsRow[] {
  const rows = new Map<string, MutableEmailCadenceMetricsRow>(PROSPECTING_EMAIL_SEQUENCE.map((step, index) => [step.stepKey, {
    stepKey: step.stepKey,
    stepNumber: index + 1,
    dayOffset: step.dayOffset,
    scheduled: 0,
    sent: 0,
    delivered: 0,
    replied: 0,
    bounced: 0,
    complaints: 0,
    unsubscribed: 0,
    failed: 0,
    expired: 0,
    cancelled: 0,
  }]));

  for (const fact of facts) {
    if (!fact.cadenceStepKey) continue;
    const row = rows.get(fact.cadenceStepKey);
    const field = metricFieldByEvent[fact.eventType as keyof typeof metricFieldByEvent];
    if (!row || !field) continue;
    row[field] += fact.quantity;
  }

  return Object.freeze([...rows.values()].map((row) => Object.freeze({
    ...row,
    scheduled: Math.max(0, row.scheduled),
    sent: Math.max(0, row.sent),
    delivered: Math.max(0, row.delivered),
    replied: Math.max(0, row.replied),
    bounced: Math.max(0, row.bounced),
    complaints: Math.max(0, row.complaints),
    unsubscribed: Math.max(0, row.unsubscribed),
    failed: Math.max(0, row.failed),
    expired: Math.max(0, row.expired),
    cancelled: Math.max(0, row.cancelled),
  })));
}
