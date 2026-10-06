import { describe, expect, it } from "vitest";

import { commercialMetricFactFingerprint } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { integratedMetricRegistry } from "@/modules/metrics/domain/integrated-metric-registry";

describe("registro integrado de métricas", () => {
  it("mantém identificadores únicos e taxas com denominador explícito", () => {
    const ids = integratedMetricRegistry.map((metric) => metric.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const metric of integratedMetricRegistry) {
      expect(metric.eventTypes.length).toBeGreaterThan(0);
      if (metric.aggregation === "RATE") expect(metric.denominatorEventTypes?.length).toBeGreaterThan(0);
    }
  });

  it("gera fingerprint determinístico sem depender da ordem do metadata", () => {
    const base = {
      workspaceId: "00000000-0000-0000-0000-000000000001",
      eventKey: "lead:00000000-0000-0000-0000-000000000002:created:v1",
      eventType: "LEAD_CREATED" as const,
      occurredAt: new Date("2040-01-01T00:00:00.000Z"),
      sourceEntityType: "Lead",
      sourceEntityId: "00000000-0000-0000-0000-000000000002",
    };
    expect(commercialMetricFactFingerprint({ ...base, safeMetadata: { b: 2, a: 1 } })).toBe(commercialMetricFactFingerprint({ ...base, safeMetadata: { a: 1, b: 2 } }));
    expect(commercialMetricFactFingerprint(base)).not.toBe(commercialMetricFactFingerprint({ ...base, quantity: -1 }));
  });
});
