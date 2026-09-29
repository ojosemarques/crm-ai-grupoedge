import { describe, expect, it } from "vitest";

import type { DashboardQuery } from "@/modules/metrics/domain/dashboard-contracts";
import {
  resolveDashboardComparisonPeriod,
  resolveDashboardPeriod,
} from "@/modules/metrics/domain/dashboard-period";

describe("períodos civis do dashboard", () => {
  const now = new Date("2035-02-10T14:00:00.000Z");
  const zone = "America/Sao_Paulo";

  it("resolve hoje, ontem, semana e mês no fuso do workspace", () => {
    expect(resolveDashboardPeriod("TODAY", undefined, undefined, now, zone)).toMatchObject({
      fromDate: "2035-02-10", toDate: "2035-02-10", from: "2035-02-10T03:00:00.000Z", to: now.toISOString(),
    });
    expect(resolveDashboardPeriod("YESTERDAY", undefined, undefined, now, zone)).toMatchObject({ fromDate: "2035-02-09", toDate: "2035-02-09" });
    expect(resolveDashboardPeriod("WEEK", undefined, undefined, now, zone)).toMatchObject({ fromDate: "2035-02-05", toDate: "2035-02-10", to: now.toISOString() });
    expect(resolveDashboardPeriod("MONTH", undefined, undefined, now, zone)).toMatchObject({ fromDate: "2035-02-01", toDate: "2035-02-10", to: now.toISOString() });
  });

  it("inclui todo o último dia personalizado e rejeita intervalos inválidos", () => {
    expect(resolveDashboardPeriod("CUSTOM", "2035-02-01", "2035-02-02", now, zone)).toMatchObject({
      from: "2035-02-01T03:00:00.000Z", to: "2035-02-03T03:00:00.000Z",
    });
    expect(() => resolveDashboardPeriod("CUSTOM", "2035-02-03", "2035-02-02", now, zone)).toThrow(/inicial/);
  });

  function query(
    preset: DashboardQuery["preset"],
    fromDate?: string,
    toDate?: string,
    reference = now,
  ): DashboardQuery {
    return {
      ...resolveDashboardPeriod(preset, fromDate, toDate, reference, zone),
      filters: {
        sdrMemberIds: [], closerMemberIds: [], teamIds: [], sourceIds: [],
        campaignIds: [], creativeIds: [], priorityCodes: [], productIds: [],
      },
    };
  }

  it("compara hoje, ontem e semana com intervalos civis equivalentes", () => {
    expect(resolveDashboardComparisonPeriod(query("TODAY"), zone)).toMatchObject({
      fromDate: "2035-02-09", toDate: "2035-02-09",
      from: "2035-02-09T03:00:00.000Z", to: "2035-02-09T14:00:00.000Z",
    });
    expect(resolveDashboardComparisonPeriod(query("YESTERDAY"), zone)).toMatchObject({
      fromDate: "2035-02-08", toDate: "2035-02-08",
      from: "2035-02-08T03:00:00.000Z", to: "2035-02-09T03:00:00.000Z",
    });
    expect(resolveDashboardComparisonPeriod(query("WEEK"), zone)).toMatchObject({
      fromDate: "2035-01-29", toDate: "2035-02-03",
      from: "2035-01-29T03:00:00.000Z", to: "2035-02-03T14:00:00.000Z",
    });
  });

  it("compara mês parcial e trata fevereiro e virada de ano", () => {
    expect(resolveDashboardComparisonPeriod(query("MONTH"), zone)).toMatchObject({
      fromDate: "2035-01-01", toDate: "2035-01-10",
      from: "2035-01-01T03:00:00.000Z", to: "2035-01-10T14:00:00.000Z",
    });
    const marchEnd = new Date("2035-03-31T15:30:00.000Z");
    expect(resolveDashboardComparisonPeriod(query("MONTH", undefined, undefined, marchEnd), zone)).toMatchObject({
      fromDate: "2035-02-01", toDate: "2035-02-28",
      to: "2035-02-28T15:30:00.000Z",
    });
    expect(resolveDashboardComparisonPeriod(query("CUSTOM", "2035-01-01", "2035-01-10"), zone)).toMatchObject({
      fromDate: "2034-12-22", toDate: "2034-12-31",
    });
    expect(resolveDashboardComparisonPeriod(query("CUSTOM", "2036-02-01", "2036-02-29"), zone)).toMatchObject({
      fromDate: "2036-01-01", toDate: "2036-01-31",
    });
  });

  it("compara mês completo com o mês civil completo anterior", () => {
    const result = resolveDashboardComparisonPeriod(
      query("CUSTOM", "2035-03-01", "2035-03-31"),
      zone,
    );
    expect(result).toMatchObject({
      fromDate: "2035-02-01", toDate: "2035-02-28",
      from: "2035-02-01T03:00:00.000Z", to: "2035-03-01T03:00:00.000Z",
    });
  });
});
