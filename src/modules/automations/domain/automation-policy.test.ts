import { describe, expect, it } from "vitest";

import {
  calculateBackoffSeconds,
  matchesAutomationConditions,
} from "@/modules/automations/domain/automation-policy";

describe("automation policy", () => {
  it("avalia todas as condições tipadas sem executar código do payload", () => {
    expect(
      matchesAutomationConditions(
        { lead: { priority: "P1", score: 82 }, replied: true },
        {
          all: [
            { path: "lead.priority", operator: "EQUALS", value: "P1" },
            { path: "lead.score", operator: "IN", value: [70, 82, 100] },
            { path: "replied", operator: "EXISTS" },
          ],
        },
      ),
    ).toBe(true);
    expect(
      matchesAutomationConditions(
        { lead: { priority: "P2" } },
        { all: [{ path: "lead.priority", operator: "EQUALS", value: "P1" }] },
      ),
    ).toBe(false);
  });

  it("calcula backoff exponencial determinístico e limitado", () => {
    expect([1, 2, 3, 4].map((attempt) => calculateBackoffSeconds(attempt, 5))).toEqual([
      5,
      10,
      20,
      40,
    ]);
    expect(calculateBackoffSeconds(20, 30)).toBe(3_600);
  });
});
