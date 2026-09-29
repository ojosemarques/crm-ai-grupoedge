import { describe, expect, it } from "vitest";

import { classifyImmediateSla } from "@/modules/leads/domain/immediate-sla";

describe("classifyImmediateSla", () => {
  const persistedThresholds = {
    healthyMaxSeconds: 60,
    attentionMaxSeconds: 180,
  };

  it.each([
    [0, "HEALTHY"],
    [60, "HEALTHY"],
    [61, "ATTENTION"],
    [180, "ATTENTION"],
    [181, "CRITICAL"],
  ] as const)("classifica %i segundos como %s", (seconds, expected) => {
    expect(classifyImmediateSla(seconds, persistedThresholds)).toBe(expected);
  });

  it("rejeita tempos e faixas incoerentes", () => {
    expect(() => classifyImmediateSla(-1, persistedThresholds)).toThrow();
    expect(() =>
      classifyImmediateSla(10, {
        healthyMaxSeconds: 180,
        attentionMaxSeconds: 60,
      }),
    ).toThrow();
  });
});
