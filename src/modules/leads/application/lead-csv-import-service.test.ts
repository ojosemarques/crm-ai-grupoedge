import { describe, expect, it } from "vitest";

import { csvEscape } from "@/modules/leads/application/lead-csv-import-service";

describe("relatório CSV seguro", () => {
  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1:A2)", "  =HYPERLINK(\"https://invalid\")"])(
    "neutraliza fórmula iniciada por %s",
    (value) => {
      const escaped = csvEscape(value).replaceAll('""', '"');
      expect(escaped).toContain(`'${value}`);
    },
  );

  it("preserva texto comum e aplica aspas segundo o formato", () => {
    expect(csvEscape("Linha válida")).toBe("Linha válida");
    expect(csvEscape("campo;com;separador")).toBe('"campo;com;separador"');
  });
});
