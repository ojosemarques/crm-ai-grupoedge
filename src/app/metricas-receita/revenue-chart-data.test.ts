import { describe, expect, it } from "vitest";
import type { RevenueTimeSeries } from "@/modules/metrics/domain/revenue-metrics-contracts";
import { revenueChartData, revenueChartDomain, revenueLineSegments } from "./revenue-chart-data";

function series(metricId: string, values: readonly (string | number | null)[]): RevenueTimeSeries[] {
  return [{ metricId, granularity: "DAY", points: values.map((value, index) => ({ bucket: `2026-09-${String(index + 1).padStart(2, "0")}`, from: "", to: "", value, state: value === null ? "UNAVAILABLE" : "AVAILABLE" })) }];
}

describe("revenueChartData", () => {
  it("converts contracted money from cents to reais and keeps missing buckets empty", () => {
    expect(revenueChartData("sales.bookings", series("sales.bookings", ["12345", null, "0"]))).toMatchObject({ money: true, points: [{ value: 123.45 }, { value: null }, { value: 0 }] });
  });

  it("keeps counts as counts and declines unsafe monetary conversions", () => {
    expect(revenueChartData("sales.leads", series("sales.leads", [12])).points[0]?.value).toBe(12);
    expect(revenueChartData("cash.received", series("cash.received", ["9007199254740993"])).points[0]?.value).toBeNull();
  });
});


describe("revenue chart geometry", () => {
  it("breaks missing buckets without joining across unavailable values", () => {
    expect(revenueLineSegments([{ value: null }, { value: 5 }, { value: 0 }, { value: null }, { value: -2 }])).toEqual([[{ index: 1, value: 5 }, { index: 2, value: 0 }], [{ index: 4, value: -2 }]]);
  });
  it("includes a zero baseline and preserves negative movements", () => {
    expect(revenueChartDomain([null, -12, 4])).toEqual({ minimum: -12, maximum: 4 });
    expect(revenueChartDomain([-3, -1])).toEqual({ minimum: -3, maximum: 0 });
    expect(revenueChartDomain([0, 0])).toEqual({ minimum: 0, maximum: 1 });
    expect(revenueLineSegments([{ value: 0 }, { value: 0 }])).toHaveLength(1);
  });
});
