import { describe, expect, it } from "vitest";

import { summarizeEmailCadenceMetrics } from "@/modules/metrics/domain/email-cadence-metrics";

describe("métricas da cadência de e-mail", () => {
  it("expõe as seis etapas na ordem da cadência, inclusive quando zeradas", () => {
    const rows = summarizeEmailCadenceMetrics([
      { eventType: "EMAIL_SENT", cadenceStepKey: "email-2", quantity: 20 },
      { eventType: "EMAIL_SENT", cadenceStepKey: "email-1", quantity: 100 },
      { eventType: "EMAIL_SENT", cadenceStepKey: "email-6", quantity: 4 },
    ]);

    expect(rows.map((row) => [row.stepKey, row.dayOffset, row.sent])).toEqual([
      ["email-1", 0, 100],
      ["email-2", 3, 20],
      ["email-3", 7, 0],
      ["email-4", 12, 0],
      ["email-5", 18, 0],
      ["email-6", 25, 4],
    ]);
  });

  it("separa os eventos de entrega e respeita correções compensatórias", () => {
    const [email1] = summarizeEmailCadenceMetrics([
      { eventType: "EMAIL_SCHEDULED", cadenceStepKey: "email-1", quantity: 3 },
      { eventType: "EMAIL_SENT", cadenceStepKey: "email-1", quantity: 3 },
      { eventType: "EMAIL_SENT", cadenceStepKey: "email-1", quantity: -1 },
      { eventType: "EMAIL_DELIVERED", cadenceStepKey: "email-1", quantity: 2 },
      { eventType: "EMAIL_REPLIED", cadenceStepKey: "email-1", quantity: 1 },
      { eventType: "EMAIL_BOUNCED", cadenceStepKey: "email-1", quantity: 1 },
      { eventType: "EMAIL_FAILED", cadenceStepKey: "email-1", quantity: 1 },
      { eventType: "EMAIL_EXPIRED", cadenceStepKey: "email-1", quantity: 1 },
      { eventType: "EMAIL_COMPLAINT", cadenceStepKey: "email-1", quantity: 1 },
      { eventType: "EMAIL_UNSUBSCRIBED", cadenceStepKey: "email-1", quantity: 1 },
      { eventType: "EMAIL_CANCELLED", cadenceStepKey: "email-1", quantity: 1 },
      { eventType: "EMAIL_SENT", cadenceStepKey: "outra-cadencia", quantity: 99 },
    ]);

    expect(email1).toMatchObject({
      scheduled: 3, sent: 2, delivered: 2, replied: 1, bounced: 1,
      failed: 1, expired: 1, complaints: 1, unsubscribed: 1, cancelled: 1,
    });
  });
});
