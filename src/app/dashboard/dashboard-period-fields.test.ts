import { describe, expect, it } from "vitest";

import { selectDashboardDate } from "./dashboard-period-fields";

describe("seleção de datas dos indicadores", () => {
  it("troca o preset por um único dia ao editar a primeira data", () => {
    expect(selectDashboardDate({ preset: "MONTH", fromDate: "2026-10-01", toDate: "2026-10-09" }, "fromDate", "2026-10-09")).toEqual({
      preset: "CUSTOM", fromDate: "2026-10-09", toDate: "2026-10-09",
    });
  });

  it("preserva o início quando o usuário amplia o período personalizado", () => {
    expect(selectDashboardDate({ preset: "CUSTOM", fromDate: "2026-10-08", toDate: "2026-10-08" }, "toDate", "2026-10-09")).toEqual({
      preset: "CUSTOM", fromDate: "2026-10-08", toDate: "2026-10-09",
    });
  });
});
