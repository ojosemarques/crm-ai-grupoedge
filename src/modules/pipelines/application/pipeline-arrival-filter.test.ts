import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pipelineArrivalFields, pipelineArrivalRange } from "./pipeline-arrival-filter";

const filters = z.object(pipelineArrivalFields);
const now = new Date("2026-10-30T01:30:00Z"); // Still Thursday in São Paulo.
const timeZone = "America/Sao_Paulo";

describe("pipeline arrival periods", () => {
  it("keeps all arrivals by default and uses the workspace day", () => {
    expect(pipelineArrivalRange(filters.parse({}), now, timeZone)).toBeNull();
    expect(pipelineArrivalRange(filters.parse({ arrivalPreset: "TODAY" }), now, timeZone)).toEqual({
      start: new Date("2026-10-29T03:00:00Z"), end: new Date("2026-10-30T03:00:00Z"),
    });
  });
  it("uses Monday through Sunday for this week", () => {
    expect(pipelineArrivalRange(filters.parse({ arrivalPreset: "WEEK" }), now, timeZone)).toMatchObject({
      start: new Date("2026-10-26T03:00:00Z"), end: new Date("2026-11-02T03:00:00Z"),
    });
  });
  it("includes the entire last custom day", () => {
    expect(pipelineArrivalRange(filters.parse({ arrivalPreset: "CUSTOM", arrivalFrom: "2026-10-27", arrivalTo: "2026-10-29" }), now, timeZone)).toEqual({
      start: new Date("2026-10-27T03:00:00Z"), end: new Date("2026-10-30T03:00:00Z"),
    });
  });
  it("rejects impossible, missing and reversed dates", () => {
    expect(filters.safeParse({ arrivalFrom: "2026-02-30" }).success).toBe(false);
    for (const dates of [{}, { arrivalFrom: "2026-10-30", arrivalTo: "2026-10-29" }]) {
      expect(() => pipelineArrivalRange(filters.parse({ arrivalPreset: "CUSTOM", ...dates }), now, timeZone)).toThrow();
    }
  });
});
